// Motor de filtros compatible con la parte más usada de la sintaxis de
// Adblock Plus / uBlock Origin / AdGuard:
//   red:        ||dominio^  |https://…  /ruta/  /regex/  @@excepciones
//               $third-party $1p $script $image $xhr $subdocument $popup
//               $document $all $domain= $important $match-case $badfilter
//               $redirect (se trata como bloqueo) $elemhide $generichide
//   cosmético:  ##sel  dominio##sel  ~dominio##sel  dominio#@#sel
//               entidades (google.*##sel)  :style(…)  :remove()
// Se ignoran (sin romper nada) los scriptlets (##+js), los filtros HTML (##^),
// los selectores procedurales y las opciones no soportadas.
// Depende de siteOf() de lib/domain.js.
"use strict";

const FT = {
  other: 1, script: 2, image: 4, stylesheet: 8, object: 16, subdocument: 32,
  xmlhttprequest: 64, websocket: 128, ping: 256, media: 512, font: 1024,
  document: 2048, popup: 4096
};
const FT_RESOURCES = 2047; // todos los tipos de recurso (sin document ni popup)

const FT_ALIASES = {
  script: "script", image: "image", stylesheet: "stylesheet", css: "stylesheet",
  object: "object", "object-subrequest": "object", subdocument: "subdocument", frame: "subdocument",
  xmlhttprequest: "xmlhttprequest", xhr: "xmlhttprequest", websocket: "websocket", ping: "ping",
  beacon: "ping", media: "media", font: "font", other: "other", document: "document", doc: "document",
  popup: "popup"
};

// Tipos de webRequest -> tipo de filtro
const FT_REQUEST = {
  main_frame: "document", sub_frame: "subdocument", stylesheet: "stylesheet", script: "script",
  image: "image", imageset: "image", font: "font", object: "object", object_subrequest: "object",
  xmlhttprequest: "xmlhttprequest", ping: "ping", beacon: "ping", media: "media", websocket: "websocket"
};

// Opciones que no implementamos: el filtro completo se descarta para no bloquear de más.
const FT_UNSUPPORTED = new Set([
  "csp", "removeparam", "queryprune", "rewrite", "header", "permissions", "replace", "urltransit",
  "cname", "denyallow", "to", "method", "inline-script", "inline-font", "genericblock", "redirect-rule",
  "specifichide", "shide", "webrtc", "jsinject", "content", "extension", "stealth", "urlblock", "hls",
  "jsonprune", "app", "network", "referrer-policy", "cookie", "ipaddress", "xmlprune", "reason"
]);

// Scriptlets: alias de uBlock Origin / AdGuard -> nombre canónico de scriptlets/lib.js
const SCRIPTLET_ALIASES = {
  "aopr": "abort-on-property-read", "abort-on-property-read": "abort-on-property-read",
  "aopw": "abort-on-property-write", "abort-on-property-write": "abort-on-property-write",
  "aost": "abort-on-stack-trace", "abort-on-stack-trace": "abort-on-stack-trace",
  "acs": "abort-current-script", "acis": "abort-current-script", "abort-current-script": "abort-current-script",
  "abort-current-inline-script": "abort-current-script",
  "set": "set-constant", "set-constant": "set-constant",
  "nostif": "no-setTimeout-if", "no-setTimeout-if": "no-setTimeout-if", "prevent-setTimeout": "no-setTimeout-if",
  "setTimeout-defuser": "no-setTimeout-if",
  "nosiif": "no-setInterval-if", "no-setInterval-if": "no-setInterval-if", "prevent-setInterval": "no-setInterval-if",
  "setInterval-defuser": "no-setInterval-if",
  "nano-sib": "nano-setInterval-booster", "nano-setInterval-booster": "nano-setInterval-booster", "adjust-setInterval": "nano-setInterval-booster",
  "nano-stb": "nano-setTimeout-booster", "nano-setTimeout-booster": "nano-setTimeout-booster", "adjust-setTimeout": "nano-setTimeout-booster",
  "aeld": "addEventListener-defuser", "addEventListener-defuser": "addEventListener-defuser",
  "prevent-addEventListener": "addEventListener-defuser",
  "nowoif": "no-window-open-if", "no-window-open-if": "no-window-open-if", "prevent-window-open": "no-window-open-if",
  "window.open-defuser": "no-window-open-if",
  "no-fetch-if": "no-fetch-if", "prevent-fetch": "no-fetch-if",
  "no-xhr-if": "no-xhr-if", "prevent-xhr": "no-xhr-if",
  "json-prune": "json-prune",
  "json-prune-fetch-response": "json-prune-fetch-response",
  "json-prune-xhr-response": "json-prune-xhr-response",
  "noeval": "noeval", "noeval-silent": "noeval", "noeval-if": "noeval-if", "prevent-eval-if": "noeval-if",
  "nowebrtc": "nowebrtc", "nowebrtc.js": "nowebrtc",
  "ra": "remove-attr", "remove-attr": "remove-attr",
  "rc": "remove-class", "remove-class": "remove-class",
  "rmnt": "remove-node-text", "remove-node-text": "remove-node-text",
  "rpnt": "replace-node-text", "replace-node-text": "replace-node-text",
  "trusted-rpnt": "replace-node-text", "trusted-replace-node-text": "replace-node-text",
  "remove-cookie": "remove-cookie", "cookie-remover": "remove-cookie",
  "set-cookie": "set-cookie",
  "set-local-storage-item": "set-local-storage-item", "set-session-storage-item": "set-session-storage-item",
  "nobab": "bab-defuser", "bab-defuser": "bab-defuser",
  "nofab": "fuckadblock-defuser", "fuckadblock.js-3.2.0": "fuckadblock-defuser", "fuckadblock-defuser": "fuckadblock-defuser",
  "popads-dummy": "popads-dummy", "popads-dummy.js": "popads-dummy",
  "href-sanitizer": "href-sanitizer"
};
// Scriptlets que pueden reescribir código: solo desde listas de confianza.
const SCRIPTLET_TRUSTED = new Set(["replace-node-text"]);
const TRUSTED_LISTS = /^(builtin|user|ubo-)/;

// Lee un argumento entre comillas a partir de body[i] (la comilla).
function ftReadQuoted(body, i) {
  const q = body[i];
  let j = i + 1;
  while (j < body.length && !(body[j] === q && body[j - 1] !== "\\")) j++;
  const next = body.indexOf(",", j);
  return { arg: body.slice(i + 1, j).split("\\" + q).join(q), end: next < 0 ? body.length : next };
}

// Lee un argumento sin comillas hasta la siguiente coma no escapada.
function ftReadPlain(body, i) {
  let j = i;
  while (j < body.length && !(body[j] === "," && body[j - 1] !== "\\")) j++;
  return { arg: body.slice(i, j).trim().split("\\,").join(","), end: j };
}

// Separa los argumentos de "+js(nombre, a, b)" respetando comillas y "\,".
function ftScriptletArgs(body) {
  const args = [];
  let i = 0;
  while (i <= body.length) {
    while (body[i] === " ") i++;
    const isQuoted = body[i] === "'" || body[i] === "\"" || body[i] === "`";
    const { arg, end } = isQuoted ? ftReadQuoted(body, i) : ftReadPlain(body, i);
    args.push(arg);
    i = end + 1;
  }
  return args;
}

function ftNormalizeScriptlet(body) {
  const args = ftScriptletArgs(body);
  const name = (args[0] || "").trim().replace(/^ubo-/, "").replace(/\.js$/, "");
  return { name: SCRIPTLET_ALIASES[name] || SCRIPTLET_ALIASES[name + ".js"] || null, raw: name, args: args.slice(1) };
}

// Firma de una excepción de scriptlet: "*" = todos; null = no reconocida.
function ftScriptletSig(body, call) {
  if (body.trim() === "") return "*";
  return call.name ? [call.name].concat(call.args).join("\u0001") : null;
}

const PROCEDURAL = /:(has-text|-abp-|xpath|matches-css|upward|watch-attr|min-text-length|others|matches-path|remove-attr|remove-class|matches-attr|matches-prop|if\(|if-not|contains|nth-ancestor|matches-media)/;
const BAD_TOKENS = new Set(["http", "https", "www", "com", "net", "org", "html", "php", "js"]);
const OPTIONS_RE = /^~?[\w-]+(?:=[^,$]*)?(?:,~?[\w-]+(?:=[^,$]*)?)*$/i;

function ftEscape(s) {
  return s.replace(/[.+?${}()[\]\\/|]/g, "\\$&");
}

function ftTrimStars(p) {
  let a = 0, b = p.length;
  while (a < b && p[a] === "*") a++;
  while (b > a && p[b - 1] === "*") b--;
  return p.slice(a, b);
}

function ftPatternToRegex(p, matchCase) {
  let start = "", end = "";
  if (p.startsWith("||")) { start = "^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#]*\\.)?"; p = p.slice(2); }
  else if (p.startsWith("|")) { start = "^"; p = p.slice(1); }
  if (p.endsWith("|")) { end = "$"; p = p.slice(0, -1); }
  const body = ftEscape(ftTrimStars(p)).replace(/\*+/g, ".*").replace(/\^/g, "(?:[^\\w.%-]|$)");
  return new RegExp(start + body + end, matchCase ? "" : "i");
}

// Token completo más largo del patrón (para indexar); "" si no hay uno seguro.
function ftBestToken(p) {
  const anchoredStart = p.startsWith("|");
  const anchoredEnd = p.endsWith("|");
  const s = p.replace(/^\|+/, "").replace(/\|$/, "").toLowerCase();
  let best = "";
  for (const m of s.matchAll(/[a-z0-9%]{3,}/g)) {
    const before = s[m.index - 1];
    const after = s[m.index + m[0].length];
    const okBefore = before === undefined ? anchoredStart : before !== "*";
    const okAfter = after === undefined ? anchoredEnd : after !== "*";
    if (okBefore && okAfter && !BAD_TOKENS.has(m[0]) && m[0].length > best.length) best = m[0];
  }
  return best;
}

function ftUrlTokens(url) {
  return new Set(url.toLowerCase().match(/[a-z0-9%]{3,}/g) || []);
}

// dominio o entidad (google.*) contra un host
function ftDomainMatches(host, d) {
  if (d.endsWith(".*")) {
    const site = siteOf(host);
    const dot = site.indexOf(".");
    if (dot < 0) return false;
    const suffixLen = site.length - dot; // ".com.mx"
    const noSuffix = host.slice(0, host.length - suffixLen);
    const e = d.slice(0, -2);
    return noSuffix === e || noSuffix.endsWith("." + e);
  }
  return host === d || host.endsWith("." + d);
}

function ftDomainsOk(rule, host) {
  if (rule.notDomains && rule.notDomains.some(d => ftDomainMatches(host, d))) return false;
  if (rule.domains) return rule.domains.some(d => ftDomainMatches(host, d));
  return true;
}

function ftParseDomainOption(value, rule) {
  for (let d of value.toLowerCase().split("|")) {
    if (!d || d[0] === "/") return false; // dominios regex: no soportado
    const key = d[0] === "~" ? "notDomains" : "domains";
    if (d[0] === "~") d = d.slice(1);
    if (!rule[key]) rule[key] = [];
    rule[key].push(d);
  }
  return true;
}

// "a.com,~b.com" -> {include:["a.com"], exclude:["b.com"]}
function ftSplitDomains(domainsPart) {
  const include = [], exclude = [];
  for (let d of domainsPart.toLowerCase().split(",")) {
    d = d.trim();
    if (!d) continue;
    if (d[0] === "~") exclude.push(d.slice(1)); else include.push(d);
  }
  return { include, exclude };
}

function ftHostCandidates(host) {
  const out = [];
  let h = host;
  while (h) {
    out.push(h);
    const i = h.indexOf(".");
    if (i < 0) break;
    h = h.slice(i + 1);
  }
  return out;
}

function ftNewTable() {
  return { pure: new Map(), byHost: new Map(), byToken: new Map(), noToken: [] };
}

function ftPush(map, key, value) {
  const arr = map.get(key);
  if (arr) arr.push(value); else map.set(key, [value]);
}

function ftAddToSet(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

// Línea de lista hosts o dominio plano -> "||dominio^"; null = ignorar; si no, la línea tal cual.
function ftNormalizeHostLine(line) {
  const hosts = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s#]+)/.exec(line);
  if (hosts) line = hosts[1];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(line)) return line;
  if (line === "0.0.0.0" || line === "localhost" || /^[\d.]+$/.test(line)) return null;
  return "||" + line.toLowerCase() + "^";
}

// Separa patrón y opciones: "patrón$op1,op2"
function ftSplitOptions(line) {
  const isRegex = /^\/.*\/$/.test(line);
  const dollar = line.lastIndexOf("$");
  const hasOptions = dollar >= 0 && OPTIONS_RE.test(line.slice(dollar + 1)) &&
    (!isRegex || /^\/.*\/\$/.test(line));
  if (!hasOptions || (isRegex && dollar === line.length - 1)) return { pattern: line, opts: "", isRegex };
  const pattern = line.slice(0, dollar);
  return { pattern, opts: line.slice(dollar + 1), isRegex: /^\/.*\/$/.test(pattern) };
}

const FT_PARTY = { "third-party": 1, "3p": 1, "strict3p": 1, "first-party": 2, "1p": 2, "strict1p": 2 };

function ftPageOption(ctx, flag) {
  if (!ctx.exception) return false;
  ctx.rule.page |= flag;
  return true;
}

const FT_OPTION_HANDLERS = {
  all(ctx) { ctx.pos |= FT_RESOURCES | FT.document | FT.popup; return true; },
  domain(ctx, value) { return ftParseDomainOption(value, ctx.rule); },
  from(ctx, value) { return ftParseDomainOption(value, ctx.rule); },
  important(ctx) { ctx.rule.important = true; return true; },
  "match-case"(ctx) { ctx.matchCase = true; return true; },
  redirect() { return true; }, // se bloquea en lugar de redirigir
  empty() { return true; },
  mp4() { return true; },
  elemhide(ctx) { return ftPageOption(ctx, 2); },
  ehide(ctx) { return ftPageOption(ctx, 2); },
  generichide(ctx) { return ftPageOption(ctx, 4); },
  ghide(ctx) { return ftPageOption(ctx, 4); }
};

// Aplica una opción "$nombre=valor" al contexto; false = no soportada.
function ftApplyOption(ctx, option) {
  const eq = option.indexOf("=");
  let name = (eq >= 0 ? option.slice(0, eq) : option).toLowerCase();
  const value = eq >= 0 ? option.slice(eq + 1) : "";
  const not = name[0] === "~";
  if (not) name = name.slice(1);
  if (FT_ALIASES[name]) {
    const bit = FT[FT_ALIASES[name]];
    if (not) ctx.neg |= bit; else ctx.pos |= bit;
    if (ctx.exception && !not && name.startsWith("doc")) ctx.rule.page |= 1;
    return true;
  }
  if (FT_PARTY[name]) {
    ctx.rule.party = not ? 3 - FT_PARTY[name] : FT_PARTY[name];
    return true;
  }
  const handler = Object.prototype.hasOwnProperty.call(FT_OPTION_HANDLERS, name) ? FT_OPTION_HANDLERS[name] : null;
  return handler ? handler(ctx, value) : false; // desconocida o no soportada (FT_UNSUPPORTED)
}

function ftCompile(pattern, isRegex, matchCase) {
  const flags = matchCase ? "" : "i";
  try {
    return isRegex ? new RegExp(pattern.slice(1, -1), flags) : ftPatternToRegex(pattern, matchCase);
  } catch (e) {
    return null; // regex inválida en la lista: se descarta el filtro
  }
}

// Selector cosmético -> {entry, css, selector}; null si no es aplicable con seguridad.
function ftCosmeticEntry(selector) {
  if (selector[0] === "^") return null;
  if (/[{}]|\/\*/.test(selector)) return null; // evita inyección de CSS
  let css = null;
  const style = /^(.+?):style\((.+)\)$/.exec(selector);
  if (style) { selector = style[1]; css = style[2]; }
  else selector = selector.replace(/:remove\(\)$/, "");
  if (PROCEDURAL.test(selector) || selector.includes(":style(")) return null;
  return { selector, css, entry: css ? selector + "{" + css + "}" : selector };
}

const FT_COSMETIC_LINE = /^([^#\s]*)(#@?#|#@?[?$%]#|#@?\$\?#)(.+)$/;

class FilterEngine {
  constructor() {
    this.block = ftNewTable();
    this.allow = ftNewTable();
    this.pageRules = [];             // excepciones $document / $elemhide / $generichide
    this.cosSpecific = new Map();    // host|entidad -> [sel]
    this.cosSpecificExc = new Map(); // host|entidad -> Set(sel)
    this.cosGenericToken = new Map();// "c:clase" | "i:id" -> [sel]
    this.cosGenericComplex = [];     // [{sel, notDomains}]
    this.cosGenericExc = new Set();
    this.scriptlets = new Map();      // host|entidad|"" -> [[nombre, ...args]]
    this.scriptletExc = new Map();    // host|entidad|"" -> Set(firma | "*")
    this.badfilters = new Set();
    this.stats = {};
  }

  static fromLists(lists) {
    const engine = new FilterEngine();
    for (const { text } of lists) {
      if (!text || !text.includes("badfilter")) continue;
      for (const line of text.split(/\r?\n/)) {
        if (line.includes("badfilter")) engine.badfilters.add(line.trim().replace(/[$,]badfilter\b/, ""));
      }
    }
    for (const { id, text } of lists) engine.addList(id, text || "");
    return engine;
  }

  addList(listId, text) {
    const st = { network: 0, cosmetic: 0, ignored: 0 };
    this.stats[listId] = st;
    for (const line of text.split(/\r?\n/)) this._addLine(line.trim(), listId, st);
    return st;
  }

  _addLine(line, listId, st) {
    if (!line || line[0] === "!" || line[0] === "[") return;
    if (this.badfilters.has(line)) { st.ignored++; return; }
    const cos = FT_COSMETIC_LINE.exec(line);
    if (cos && !/[/|^$]/.test(cos[1])) {
      const kind = this.addCosmetic(cos[1], cos[2], cos[3], listId);
      if (kind === "js") st.scriptlets = (st.scriptlets || 0) + 1;
      else if (kind) st.cosmetic++;
      else st.ignored++;
      return;
    }
    if (line[0] === "#") return; // comentario estilo hosts
    const network = ftNormalizeHostLine(line);
    if (network === null) return;
    if (this.addNetwork(network, listId)) st.network++; else st.ignored++;
  }

  addNetwork(line, listId) {
    const exception = line.startsWith("@@");
    const { pattern, opts, isRegex } = ftSplitOptions(exception ? line.slice(2) : line);
    const rule = { raw: line, list: listId, mask: 0, party: 0, important: false, re: null, hostOnly: false, page: 0 };
    const ctx = { rule, exception, pos: 0, neg: 0, matchCase: false };
    if (opts && !opts.split(",").every(o => ftApplyOption(ctx, o))) return false;
    if (ctx.pos) rule.mask = ctx.pos & ~ctx.neg;
    else if (ctx.neg) rule.mask = FT_RESOURCES & ~ctx.neg;

    if (rule.page) {
      if (!this._addPageRule(rule, pattern, isRegex, ctx.matchCase)) return false;
      if (!(rule.mask & ~FT.document)) return true; // solo afecta a la página
    }
    return this._indexRule(exception ? this.allow : this.block, rule, pattern, opts, isRegex, ctx.matchCase);
  }

  // Excepciones a nivel de página ($document, $elemhide, $generichide)
  _addPageRule(rule, pattern, isRegex, matchCase) {
    if (pattern && pattern !== "*") {
      rule.re = ftCompile(pattern, isRegex, matchCase);
      if (!rule.re) return false;
    }
    this.pageRules.push(rule);
    return true;
  }

  // "||dominio^" (con o sin opciones): índice por host, sin regex
  _indexHostRule(table, rule, host, opts) {
    if (opts) {
      rule.hostOnly = true;
      ftPush(table.byHost, host, rule);
    } else if (!table.pure.has(host)) {
      table.pure.set(host, rule.list);
    }
    return true;
  }

  _indexRule(table, rule, pattern, opts, isRegex, matchCase) {
    const hostMatch = /^\|\|([a-z0-9.-]+\.[a-z0-9-]+)(\^\|?|\/|:|$)/i.exec(pattern);
    const rest = hostMatch ? pattern.slice(hostMatch[0].length - hostMatch[2].length) : "";
    if (hostMatch && !pattern.includes("*") && /^\^?\|?$/.test(rest)) {
      return this._indexHostRule(table, rule, hostMatch[1].toLowerCase(), opts);
    }
    if (pattern === "" || pattern === "*" || pattern === "|" || pattern === "||") {
      if (!opts) return false; // bloquearía todo
      table.noToken.push(rule);
      return true;
    }
    rule.re = ftCompile(pattern, isRegex, matchCase);
    if (!rule.re) return false;
    if (hostMatch) {
      ftPush(table.byHost, hostMatch[1].toLowerCase(), rule);
      return true;
    }
    const token = isRegex ? "" : ftBestToken(pattern);
    if (token) ftPush(table.byToken, token, rule); else table.noToken.push(rule);
    return true;
  }

  addScriptlet(domainsPart, exception, body, listId) {
    const call = ftNormalizeScriptlet(body);
    const { include, exclude } = ftSplitDomains(domainsPart);
    if (exception) {
      const sig = ftScriptletSig(body, call);
      if (!sig) return false;
      for (const d of include.length ? include : [""]) ftAddToSet(this.scriptletExc, d, sig);
      return "js";
    }
    if (!call.name) return false;
    if (SCRIPTLET_TRUSTED.has(call.name) && !TRUSTED_LISTS.test(listId || "")) return false;
    const entry = [call.name].concat(call.args);
    for (const d of exclude) ftAddToSet(this.scriptletExc, d, entry.join("\u0001"));
    for (const d of include.length ? include : [""]) ftPush(this.scriptlets, d, entry);
    return "js";
  }

  // Datos para el content script de scriptlets: {specific, entity, generic, exc}
  scriptletData() {
    const specific = {}, entity = {}, exc = {};
    let generic = [];
    for (const [k, calls] of this.scriptlets) {
      if (k === "") generic = calls;
      else if (k.endsWith(".*")) entity[k] = calls;
      else specific[k] = calls;
    }
    for (const [k, set] of this.scriptletExc) exc[k] = [...set];
    return { specific, entity, generic, exc };
  }

  // Sintaxis de scriptlets: "##+js(…)" (uBO) y "#%#//scriptlet(…)" (AdGuard). undefined = no es scriptlet.
  _addScriptletSyntax(domainsPart, sep, selector, listId) {
    const adguard = selector.startsWith("//scriptlet(") && selector.endsWith(")");
    if (adguard && (sep === "#%#" || sep === "#@%#")) {
      return this.addScriptlet(domainsPart, sep === "#@%#", selector.slice(12, -1), listId);
    }
    if ((sep === "##" || sep === "#@#") && selector.startsWith("+js(") && selector.endsWith(")")) {
      return this.addScriptlet(domainsPart, sep === "#@#", selector.slice(4, -1), listId);
    }
    return undefined;
  }

  addCosmetic(domainsPart, sep, selector, listId) {
    const scriptlet = this._addScriptletSyntax(domainsPart, sep, selector, listId);
    if (scriptlet !== undefined) return scriptlet;
    if (sep !== "##" && sep !== "#@#") return false; // otros extendidos de AdGuard
    const parsed = ftCosmeticEntry(selector);
    if (!parsed) return false;
    const { include, exclude } = ftSplitDomains(domainsPart);
    if (sep === "#@#") {
      this._addCosmeticException(include, parsed.entry);
      return true;
    }
    if (include.length) {
      for (const d of include) ftPush(this.cosSpecific, d, parsed.entry);
      return true;
    }
    if (parsed.css) return false; // :style genérico: demasiado arriesgado
    this._addGenericCosmetic(parsed.selector, exclude);
    return true;
  }

  _addCosmeticException(include, entry) {
    if (!include.length) { this.cosGenericExc.add(entry); return; }
    for (const d of include) ftAddToSet(this.cosSpecificExc, d, entry);
  }

  _addGenericCosmetic(selector, exclude) {
    const simple = /^([.#])([\w-]+)/.exec(selector);
    if (simple && !exclude.length) {
      ftPush(this.cosGenericToken, (simple[1] === "." ? "c:" : "i:") + simple[2], selector);
    } else {
      this.cosGenericComplex.push({ sel: selector, notDomains: exclude.length ? exclude : null });
    }
  }

  // ---------- Red ----------

  _typeOk(r, bit) {
    if (r.mask) return (r.mask & bit) !== 0;
    return (bit & FT_RESOURCES) !== 0 || (bit === FT.document && r.hostOnly);
  }

  _ruleOk(r, req, bit) {
    if (!this._typeOk(r, bit)) return false;
    if (r.party === 1 && !req.thirdParty) return false;
    if (r.party === 2 && req.thirdParty) return false;
    if ((r.domains || r.notDomains) && !ftDomainsOk(r, req.docHost || "")) return false;
    return !r.re || r.re.test(req.url);
  }

  _firstOk(rules, req, bit) {
    if (!rules) return null;
    return rules.find(r => this._ruleOk(r, req, bit)) || null;
  }

  _find(table, req, bit, hosts, tokens) {
    for (const h of hosts) {
      if (bit !== FT.popup && table.pure.has(h)) return { raw: "||" + h + "^", list: table.pure.get(h), important: false };
      const hit = this._firstOk(table.byHost.get(h), req, bit);
      if (hit) return hit;
    }
    for (const t of tokens) {
      const hit = this._firstOk(table.byToken.get(t), req, bit);
      if (hit) return hit;
    }
    return this._firstOk(table.noToken, req, bit);
  }

  // req: {url, host, type (tipo de webRequest o de filtro), docHost, thirdParty}
  // Devuelve el filtro que bloquea o null.
  match(req) {
    const type = FT[req.type] ? req.type : (FT_REQUEST[req.type] || "other");
    const bit = FT[type];
    const hosts = ftHostCandidates(req.host);
    const tokens = ftUrlTokens(req.url);
    const block = this._find(this.block, req, bit, hosts, tokens);
    if (!block) return null;
    if (!block.important && this._find(this.allow, req, bit, hosts, tokens)) return null;
    return block;
  }

  // Flags de página: {document, elemhide, generichide}
  pageFlags(url, host) {
    const f = { document: false, elemhide: false, generichide: false };
    if (!url || !host) return f;
    for (const r of this.pageRules) {
      if (r.re && !r.re.test(url)) continue;
      if ((r.domains || r.notDomains) && !ftDomainsOk(r, host)) continue;
      if (r.page & 1) f.document = true;
      if (r.page & 2) f.elemhide = true;
      if (r.page & 4) f.generichide = true;
    }
    return f;
  }

  // ---------- Cosmético ----------

  _specificKeys(host) {
    const keys = ftHostCandidates(host);
    const site = siteOf(host);
    const dot = site.indexOf(".");
    if (dot > 0) {
      const noSuffix = host.slice(0, host.length - (site.length - dot));
      for (const h of ftHostCandidates(noSuffix)) keys.push(h + ".*");
    }
    return keys;
  }

  _exceptionsFor(host) {
    const exc = new Set(this.cosGenericExc);
    for (const k of this._specificKeys(host)) {
      for (const sel of this.cosSpecificExc.get(k) || []) exc.add(sel);
    }
    return exc;
  }

  static toCss(entries) {
    return entries.map(e => (e.endsWith("}") ? e : e + "{display:none!important}")).join("\n");
  }

  _specificSelectors(host, exc) {
    const out = [];
    for (const k of this._specificKeys(host)) {
      for (const s of this.cosSpecific.get(k) || []) if (!exc.has(s)) out.push(s);
    }
    return out;
  }

  _complexSelectors(host, exc) {
    return this.cosGenericComplex
      .filter(({ sel, notDomains }) => !exc.has(sel) && !(notDomains && notDomains.some(d => ftDomainMatches(host, d))))
      .map(({ sel }) => sel);
  }

  // CSS inicial de una página: específico del sitio + genérico complejo.
  cosmeticCss(host, flags) {
    if (flags && flags.elemhide) return "";
    const exc = this._exceptionsFor(host);
    const out = this._specificSelectors(host, exc);
    if (!(flags && flags.generichide)) out.push(...this._complexSelectors(host, exc));
    return FilterEngine.toCss([...new Set(out)]);
  }

  // CSS genérico para las clases / ids que el content script vio en la página.
  genericCss(host, tokens, flags) {
    if (flags && (flags.elemhide || flags.generichide)) return "";
    const exc = this._exceptionsFor(host);
    const out = new Set();
    for (const t of tokens) {
      for (const s of this.cosGenericToken.get(t) || []) if (!exc.has(s)) out.add(s);
    }
    return FilterEngine.toCss([...out]);
  }
}

if (typeof module !== "undefined") {
  module.exports = { FilterEngine, ftPatternToRegex, ftBestToken };
}
