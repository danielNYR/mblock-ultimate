// Biblioteca de scriptlets de MBlock Ultimate. Se ejecuta en el contexto de la
// página (world: "MAIN") antes que los scripts del sitio. Recibe las llamadas a
// ejecutar desde content/scriptlet-loader.js a través de dos propiedades-trampa
// de window que se eliminan al terminar la carga del documento.
// Nombres y semántica compatibles con los scriptlets de uBlock Origin
// (los alias cortos se resuelven en lib/filters.js antes de llegar aquí).
(function () {
  "use strict";
  const win = window;
  const doc = document;
  const KEYS = ["__mbs$1", "__mbs$2"];
  // Copias de las funciones nativas antes de que la página pueda tocarlas
  const N = {
    defineProperty: Object.defineProperty,
    getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
    Proxy: win.Proxy,
    Reflect: win.Reflect,
    JSONparse: JSON.parse,
    JSONstringify: JSON.stringify,
    RegExp: win.RegExp,
    Error: win.Error,
    ReferenceError: win.ReferenceError,
    Response: win.Response,
    fetch: win.fetch,
    MutationObserver: win.MutationObserver,
    setTimeout: win.setTimeout,
    Promise: win.Promise
  };
  // Texto aleatorio para los errores que lanzan los scriptlets (no es material criptográfico).
  const token = () => "mbs" + win.crypto.getRandomValues(new Uint32Array(2)).join("").slice(0, 12);

  // ---------- utilidades ----------

  function patternToRegex(pattern, flags) {
    if (pattern === undefined || pattern === "") return /^/;
    const m = /^\/(.+)\/([gimsu]*)$/.exec(pattern);
    if (m) {
      try { return new N.RegExp(m[1], flags || m[2]); } catch (e) { return /^\b$/; }
    }
    return new N.RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  }

  function negatable(pattern) {
    const not = typeof pattern === "string" && pattern.startsWith("!");
    return { re: patternToRegex(not ? pattern.slice(1) : pattern), not };
  }

  function constantValue(raw) {
    switch (raw) {
      case "undefined": return { v: undefined };
      case "false": return { v: false };
      case "true": return { v: true };
      case "null": return { v: null };
      case "''": case "\"\"": case "emptyStr": return { v: "" };
      case "noopFunc": return { v: function () {} };
      case "trueFunc": return { v: function () { return true; } };
      case "falseFunc": return { v: function () { return false; } };
      case "throwFunc": return { v: function () { throw new N.Error(token()); } };
      case "emptyObj": case "{}": return { v: {} };
      case "emptyArr": case "[]": return { v: [] };
      case "noopCallbackFunc": return { v: function () { return function () {}; } };
      case "yes": case "no": case "on": case "off": return { v: raw };
    }
    if (/^-?\d+$/.test(raw) && Math.abs(+raw) <= 0x7FFF) return { v: +raw };
    return null;
  }

  // Recorre "a.b.c" y, si un eslabón aún no existe, lo intercepta hasta que
  // la página lo cree; entonces sigue. onLeaf(owner, prop) instala la trampa final.
  function trapChain(owner, chain, onLeaf) {
    const pos = chain.indexOf(".");
    if (pos === -1) { onLeaf(owner, chain); return; }
    const prop = chain.slice(0, pos);
    const rest = chain.slice(pos + 1);
    let value = owner[prop];
    if (value instanceof Object || (typeof value === "object" && value !== null)) {
      trapChain(value, rest, onLeaf);
      return;
    }
    if (value !== undefined) return;
    const desc = N.getOwnPropertyDescriptor(owner, prop);
    if (desc && (desc.set || desc.configurable === false)) return;
    N.defineProperty(owner, prop, {
      configurable: true,
      get() { return value; },
      set(a) {
        value = a;
        if (a instanceof Object) trapChain(a, rest, onLeaf);
      }
    });
  }

  function currentScriptText(script) {
    if (!script) return "";
    const text = script.textContent;
    if (text.trim() !== "") return text;
    const m = /^data:[^,]*,(.+)$/.exec((script.src || "").trim());
    if (!m) return "";
    try { return /;base64/.test(script.src) ? atob(m[1]) : decodeURIComponent(m[1]); } catch (e) { return ""; }
  }

  function matchesProps(propsRaw, details) {
    // "url:/x/ method:POST" ; un valor sin clave se compara con la URL
    if (!propsRaw || propsRaw === "*") return true;
    for (const part of propsRaw.split(/\s+/)) {
      if (!part) continue;
      const i = part.indexOf(":");
      const key = i > 0 && /^[a-z]+$/i.test(part.slice(0, i)) ? part.slice(0, i) : "url";
      const val = i > 0 && key === part.slice(0, i) ? part.slice(i + 1) : part;
      if (!patternToRegex(val).test(String(details[key] === undefined ? "" : details[key]))) return false;
    }
    return true;
  }

  // Borra rutas tipo "a.b.c", "[].x", "a.*.b" de un objeto JSON.
  const isObj = o => o !== null && typeof o === "object";
  const ownKey = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const WILDCARDS = new Set(["[]", "*", "[-]"]);

  function splitPath(path) {
    const i = path.indexOf(".");
    return i < 0 ? [path, ""] : [path.slice(0, i), path.slice(i + 1)];
  }

  // ¿Existe la ruta "a.b.c" / "[].x" en el objeto?
  function jsonHas(o, path) {
    if (path === "") return true;
    if (!isObj(o)) return false;
    const [key, rest] = splitPath(path);
    if (WILDCARDS.has(key)) return Object.keys(o).some(k => jsonHas(o[k], rest));
    return ownKey(o, key) && jsonHas(o[key], rest);
  }

  // "[-]": elimina del arreglo los elementos que contienen la ruta restante
  function jsonDelArrayItems(o, rest) {
    if (!Array.isArray(o)) return false;
    let done = false;
    for (let k = o.length - 1; k >= 0; k--) {
      if (!rest || jsonHas(o[k], rest)) { o.splice(k, 1); done = true; }
    }
    return done;
  }

  function jsonDelEach(o, rest) {
    let done = false;
    for (const k of Object.keys(o)) {
      if (rest) done = jsonDel(o[k], rest) || done;
      else { delete o[k]; done = true; }
    }
    return done;
  }

  function jsonDel(o, path) {
    if (!isObj(o)) return false;
    const [key, rest] = splitPath(path);
    if (key === "[-]") return jsonDelArrayItems(o, rest);
    if (key === "[]" || key === "*") return jsonDelEach(o, rest);
    if (!ownKey(o, key)) return false;
    if (rest) return jsonDel(o[key], rest);
    delete o[key];
    return true;
  }

  const words = str => (str || "").split(/\s+/).filter(Boolean);

  // Borra rutas tipo "a.b.c", "[].x", "a.*.b", "[-].x" si están todas las rutas requeridas.
  function pruneObject(obj, toRemove, required) {
    if (!isObj(obj)) return obj;
    const req = words(required);
    if (req.length && !req.every(p => jsonHas(obj, p))) return obj;
    for (const p of words(toRemove)) jsonDel(obj, p);
    return obj;
  }

  const splitPipes = str => str.split("|").map(x => x.trim()).filter(Boolean);

  function queryAll(selector) {
    try {
      return doc.querySelectorAll(selector);
    } catch {
      return []; // selector inválido en el filtro
    }
  }

  function onDomReady(fn) {
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
  }

  function observeDom(fn, stay) {
    fn();
    const obs = new N.MutationObserver(fn);
    const start = () => obs.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
    if (doc.documentElement) start(); else onDomReady(start);
    if (!stay) win.addEventListener("load", () => N.setTimeout(() => obs.disconnect(), 3000), { once: true });
  }

  function wrapMethod(owner, name, handler) {
    const fn = owner && owner[name];
    if (typeof fn !== "function") return;
    owner[name] = new N.Proxy(fn, { apply: handler });
  }

  // ---------- scriptlets ----------

  const S = Object.create(null);

  S["abort-on-property-read"] = function (chain) {
    if (!chain) return;
    const t = token();
    trapChain(win, chain, (owner, prop) => {
      const desc = N.getOwnPropertyDescriptor(owner, prop);
      if (desc && desc.configurable === false) return;
      N.defineProperty(owner, prop, {
        configurable: true,
        get() { throw new N.ReferenceError(t); },
        set() {}
      });
    });
  };

  S["abort-on-property-write"] = function (prop) {
    if (!prop) return;
    let owner = win;
    for (;;) {
      const pos = prop.indexOf(".");
      if (pos === -1) break;
      owner = owner[prop.slice(0, pos)];
      if (!(owner instanceof Object)) return;
      prop = prop.slice(pos + 1);
    }
    delete owner[prop];
    const t = token();
    N.defineProperty(owner, prop, { configurable: true, set() { throw new N.ReferenceError(t); } });
  };

  // inlineScript: código inline de la página; injectedScript: código sin archivo (eval, etc.)
  function stackMatcher(needle) {
    if (needle === "injectedScript") {
      return lines => lines.some(l => l.includes("<anonymous>") || l.trim() === "" || l.trim() === "@");
    }
    const re = patternToRegex(needle === "inlineScript" ? location.href.split("#")[0] : needle);
    return lines => re.test(lines.join("\n"));
  }

  S["abort-on-stack-trace"] = function (chain, needle) {
    if (!chain) return;
    const t = token();
    const matches = stackMatcher(needle);
    const check = () => {
      const lines = (new N.Error().stack || "").split("\n").slice(2);
      if (matches(lines)) throw new N.ReferenceError(t);
    };
    trapChain(win, chain, (owner, prop) => {
      let value = owner[prop];
      const desc = N.getOwnPropertyDescriptor(owner, prop);
      if (desc && desc.configurable === false) return;
      N.defineProperty(owner, prop, {
        configurable: true,
        get() { check(); return value; },
        set(a) { check(); value = a; }
      });
    });
  };

  S["abort-current-script"] = function (chain, needle) {
    if (!chain) return;
    const re = patternToRegex(needle);
    const self = doc.currentScript;
    const t = token();
    const check = () => {
      const e = doc.currentScript;
      if (!(e instanceof HTMLScriptElement) || e === self) return;
      if (needle && !re.test(currentScriptText(e))) return;
      throw new N.ReferenceError(t);
    };
    trapChain(win, chain, (owner, prop) => {
      const desc = N.getOwnPropertyDescriptor(owner, prop);
      if (desc && desc.configurable === false) return;
      let value = owner[prop];
      const getter = desc && desc.get;
      const setter = desc && desc.set;
      N.defineProperty(owner, prop, {
        configurable: true,
        get() { check(); return getter ? getter.call(owner) : value; },
        set(a) { check(); if (setter) setter.call(owner, a); else value = a; }
      });
    });
  };

  S["set-constant"] = function (chain, raw, wrap) {
    if (!chain) return;
    const c = constantValue(raw);
    if (!c) return;
    let value = c.v;
    if (wrap === "asFunction") { const v = value; value = function () { return v; }; }
    else if (wrap === "asCallback") { const v = value; value = function () { return function () { return v; }; }; }
    else if (wrap === "asResolved") value = N.Promise.resolve(value);
    else if (wrap === "asRejected") value = N.Promise.reject(value);
    trapChain(win, chain, (owner, prop) => {
      const desc = N.getOwnPropertyDescriptor(owner, prop);
      if (desc && desc.configurable === false) return;
      N.defineProperty(owner, prop, {
        configurable: true,
        get() { return value; },
        set() { /* la página no puede cambiarla */ }
      });
    });
  };

  function timerIf(name) {
    return function (needle, delay) {
      if ((needle === undefined || needle === "") && (delay === undefined || delay === "")) return;
      const n = negatable(needle || "");
      const notDelay = typeof delay === "string" && delay.startsWith("!");
      const delayText = notDelay ? delay.slice(1) : delay;
      const delayValue = delayText ? parseInt(delayText, 10) : NaN;
      wrapMethod(win, name, (target, thisArg, args) => {
        const code = String(args[0]);
        const needleOk = !needle || n.re.test(code) !== n.not;
        const delayOk = isNaN(delayValue) || ((args[1] === delayValue) !== notDelay);
        if (needleOk && delayOk) args[0] = function () {};
        return N.Reflect.apply(target, thisArg, args);
      });
    };
  }
  S["no-setTimeout-if"] = timerIf("setTimeout");
  S["no-setInterval-if"] = timerIf("setInterval");

  function booster(name) {
    return function (needle, delay, boost) {
      const re = patternToRegex(needle === "*" ? "" : needle);
      const d = delay ? parseInt(delay, 10) : 1000;
      let b = parseFloat(boost);
      if (isNaN(b) || !isFinite(b)) b = 0.05;
      b = Math.min(Math.max(b, 0.001), 50);
      wrapMethod(win, name, (target, thisArg, args) => {
        if ((isNaN(d) || args[1] === d) && re.test(String(args[0]))) args[1] = args[1] * b;
        return N.Reflect.apply(target, thisArg, args);
      });
    };
  }
  S["nano-setInterval-booster"] = booster("setInterval");
  S["nano-setTimeout-booster"] = booster("setTimeout");

  S["addEventListener-defuser"] = function (type, handler) {
    if ((type === undefined || type === "") && (handler === undefined || handler === "")) return;
    const reType = patternToRegex(type);
    const reHandler = patternToRegex(handler);
    wrapMethod(win.EventTarget && win.EventTarget.prototype, "addEventListener", (target, thisArg, args) => {
      let h = "";
      try {
        const fn = args[1];
        h = String(fn instanceof Object && typeof fn.handleEvent === "function" ? fn.handleEvent : fn);
      } catch (e) { /* objeto raro */ }
      if (reType.test(String(args[0])) && reHandler.test(h)) return undefined;
      return N.Reflect.apply(target, thisArg, args);
    });
  };

  S["no-window-open-if"] = function (pattern) {
    const n = negatable(pattern || "");
    const decoy = () => new N.Proxy({}, {
      get(t, p) {
        if (p === "closed") return false;
        if (p === "document" || p === "location" || p === "window") return {};
        return function () {};
      },
      set() { return true; }
    });
    wrapMethod(win, "open", (target, thisArg, args) => {
      const url = String(args[0] === undefined ? "" : args[0]);
      if ((pattern === undefined || pattern === "" || n.re.test(url) !== n.not)) return decoy();
      return N.Reflect.apply(target, thisArg, args);
    });
  };

  const FETCH_BODIES = { emptyArray: "[]", emptyObj: "{}" };

  function fetchDetails(args) {
    try {
      const r = args[0] instanceof win.Request ? args[0] : null;
      const base = r ? { url: r.url, method: r.method } : { url: String(args[0]), method: "GET" };
      return Object.assign(base, args[1] instanceof Object ? args[1] : {});
    } catch {
      return { url: String(args[0]) }; // argumentos raros: se compara solo la URL
    }
  }

  S["no-fetch-if"] = function (props, body) {
    if (props === undefined) return;
    wrapMethod(win, "fetch", (target, thisArg, args) => {
      if (!matchesProps(props, fetchDetails(args))) return N.Reflect.apply(target, thisArg, args);
      const text = FETCH_BODIES[body] || "";
      return N.Promise.resolve(new N.Response(text, { status: 200, statusText: "OK" }));
    });
  };

  S["no-xhr-if"] = function (props) {
    if (props === undefined) return;
    const XHR = win.XMLHttpRequest;
    if (!XHR) return;
    const blocked = new WeakSet();
    wrapMethod(XHR.prototype, "open", (target, thisArg, args) => {
      if (matchesProps(props, { method: String(args[0]), url: String(args[1]) })) blocked.add(thisArg);
      return N.Reflect.apply(target, thisArg, args);
    });
    wrapMethod(XHR.prototype, "send", (target, thisArg, args) => {
      if (!blocked.has(thisArg)) return N.Reflect.apply(target, thisArg, args);
      N.defineProperty(thisArg, "readyState", { value: 4 });
      N.defineProperty(thisArg, "status", { value: 200 });
      N.defineProperty(thisArg, "statusText", { value: "OK" });
      N.defineProperty(thisArg, "responseText", { value: "" });
      N.defineProperty(thisArg, "response", { value: "" });
      N.setTimeout(() => {
        for (const t of ["readystatechange", "load", "loadend"]) thisArg.dispatchEvent(new win.Event(t));
      }, 1);
      return undefined;
    });
  };

  S["json-prune"] = function (toRemove, required) {
    if (!toRemove) return;
    JSON.parse = new N.Proxy(JSON.parse, {
      apply(target, thisArg, args) { return pruneObject(N.Reflect.apply(target, thisArg, args), toRemove, required); }
    });
    if (win.Response) {
      wrapMethod(win.Response.prototype, "json", (target, thisArg, args) =>
        N.Reflect.apply(target, thisArg, args).then(o => pruneObject(o, toRemove, required)));
    }
  };

  function urlMatcher(extra) {
    // argumentos extra en pares: "propsToMatch", "<patrón de URL>"
    for (let i = 0; i < extra.length - 1; i++) {
      if (extra[i] === "propsToMatch") return patternToRegex(extra[i + 1].replace(/^url:/, ""));
    }
    return /^/;
  }

  S["json-prune-fetch-response"] = function (toRemove, required, ...extra) {
    if (!toRemove) return;
    const reUrl = urlMatcher(extra);
    wrapMethod(win, "fetch", (target, thisArg, args) => {
      let url = "";
      try { url = args[0] instanceof win.Request ? args[0].url : String(args[0]); } catch (e) { /* nada */ }
      const p = N.Reflect.apply(target, thisArg, args);
      if (!reUrl.test(url)) return p;
      return p.then(res => res.clone().text().then(text => {
        let obj;
        try { obj = N.JSONparse(text); } catch (e) { return res; }
        const out = new N.Response(N.JSONstringify(pruneObject(obj, toRemove, required)),
          { status: res.status, statusText: res.statusText, headers: res.headers });
        N.defineProperty(out, "url", { value: res.url });
        N.defineProperty(out, "redirected", { value: res.redirected });
        N.defineProperty(out, "type", { value: res.type });
        return out;
      }).catch(() => res));
    });
  };

  S["json-prune-xhr-response"] = function (toRemove, required, ...extra) {
    if (!toRemove) return;
    const XHR = win.XMLHttpRequest;
    if (!XHR) return;
    const reUrl = urlMatcher(extra);
    const urls = new WeakMap();
    const cache = new WeakMap();
    wrapMethod(XHR.prototype, "open", (target, thisArg, args) => {
      urls.set(thisArg, String(args[1]));
      cache.delete(thisArg);
      return N.Reflect.apply(target, thisArg, args);
    });
    for (const prop of ["response", "responseText"]) {
      const desc = N.getOwnPropertyDescriptor(XHR.prototype, prop);
      if (!desc || !desc.get) continue;
      N.defineProperty(XHR.prototype, prop, Object.assign({}, desc, {
        get() {
          const raw = desc.get.call(this);
          if (this.readyState !== 4 || !reUrl.test(urls.get(this) || "")) return raw;
          if (typeof raw !== "string" && !(raw instanceof Object)) return raw;
          if (!cache.has(this)) {
            try {
              const obj = typeof raw === "string" ? N.JSONparse(raw) : raw;
              cache.set(this, pruneObject(obj, toRemove, required));
            } catch {
              cache.set(this, null); // no es JSON: se deja la respuesta original
            }
          }
          const pruned = cache.get(this);
          if (pruned === null) return raw;
          return typeof raw === "string" ? N.JSONstringify(pruned) : pruned;
        }
      }));
    }
  };

  S["noeval-if"] = function (needle) {
    const re = patternToRegex(needle);
    wrapMethod(win, "eval", (target, thisArg, args) => {
      if (re.test(String(args[0]))) return undefined;
      return N.Reflect.apply(target, thisArg, args);
    });
  };
  S["noeval"] = function () { S["noeval-if"](""); };

  S["nowebrtc"] = function () {
    const Stub = function () {};
    Stub.prototype = {
      close() {}, createDataChannel() { return {}; }, createOffer() { return N.Promise.resolve(); },
      setLocalDescription() { return N.Promise.resolve(); }, setRemoteDescription() { return N.Promise.resolve(); },
      addEventListener() {}, removeEventListener() {}, addIceCandidate() { return N.Promise.resolve(); }
    };
    for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection"]) {
      if (win[name]) win[name] = Stub;
    }
  };

  S["remove-attr"] = function (attrs, selector, behavior) {
    if (!attrs) return;
    const list = splitPipes(attrs);
    const sel = selector || list.map(a => `[${a}]`).join(",");
    const run = () => {
      for (const el of queryAll(sel)) for (const a of list) el.removeAttribute(a);
    };
    if (behavior && /complete/.test(behavior)) win.addEventListener("load", run, { once: true });
    else onDomReady(() => observeDom(run, /stay/.test(behavior || "")));
  };

  S["remove-class"] = function (classes, selector, behavior) {
    if (!classes) return;
    const list = splitPipes(classes);
    const sel = selector || list.map(c => "." + CSS.escape(c)).join(",");
    const run = () => {
      for (const el of queryAll(sel)) el.classList.remove(...list);
    };
    if (behavior && /complete/.test(behavior)) win.addEventListener("load", run, { once: true });
    else onDomReady(() => observeDom(run, /stay/.test(behavior || "")));
  };

  function nodeTextScriptlet(nodeName, pattern, replacement) {
    if (!nodeName) return;
    const reName = patternToRegex(nodeName, "i");
    const re = patternToRegex(pattern);
    const handle = node => {
      if (!reName.test(node.nodeName)) return;
      const text = node.textContent;
      if (!re.test(text)) return;
      node.textContent = replacement === undefined ? "" : text.replace(re, replacement);
    };
    const obs = new N.MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) handle(n);
    });
    const start = () => {
      for (const n of doc.querySelectorAll(nodeName.replace(/[^a-z0-9-]/gi, "") || "script")) handle(n);
      obs.observe(doc, { childList: true, subtree: true });
    };
    start();
    win.addEventListener("load", () => N.setTimeout(() => obs.disconnect(), 3000), { once: true });
  }
  S["remove-node-text"] = function (nodeName, condition) { nodeTextScriptlet(nodeName, condition, undefined); };
  S["replace-node-text"] = function (nodeName, pattern, replacement) {
    if (replacement === undefined) return;
    nodeTextScriptlet(nodeName, pattern, replacement);
  };

  S["remove-cookie"] = function (needle) {
    const re = patternToRegex(needle);
    const remove = () => {
      for (const part of doc.cookie.split(";")) {
        const name = part.split("=")[0].trim();
        if (!name || !re.test(name)) continue;
        const domains = [];
        const h = location.hostname.split(".");
        for (let i = 0; i < h.length - 1; i++) domains.push(h.slice(i).join("."));
        for (const d of [""].concat(domains)) {
          doc.cookie = `${name}=; Max-Age=-1000; path=/` + (d ? `; domain=${d}` : "");
          doc.cookie = `${name}=; Max-Age=-1000; path=/` + (d ? `; domain=.${d}` : "");
        }
      }
    };
    remove();
    win.addEventListener("beforeunload", remove);
    doc.addEventListener("visibilitychange", remove);
  };

  const SAFE_VALUES = new Set(["", "true", "false", "yes", "no", "y", "n", "ok", "on", "off", "accept", "accepted",
    "reject", "rejected", "allow", "allowed", "deny", "denied", "enabled", "disabled", "necessary", "required",
    "approved", "hide", "hidden", "essential", "nonessential", "dismiss", "dismissed", "checked", "unchecked"]);

  S["set-cookie"] = function (name, value, path) {
    if (!name || value === undefined) return;
    const v = value.toLowerCase();
    if (!SAFE_VALUES.has(v) && !(/^\d+$/.test(v) && +v <= 0x7FFF)) return;
    if (new N.RegExp("(?:^|;\\s*)" + encodeURIComponent(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=").test(doc.cookie)) return;
    doc.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}` + (path === "none" ? "" : "; path=/");
  };

  function storageItem(storageName) {
    return function (key, value) {
      if (!key || value === undefined) return;
      let storage;
      try { storage = win[storageName]; } catch (e) { return; }
      if (!storage) return;
      if (value === "$remove$") { storage.removeItem(key); return; }
      const map = { emptyArr: "[]", emptyObj: "{}", emptyStr: "", "''": "", "\"\"": "", "{}": "{}", "[]": "[]", undefined: "undefined", null: "null" };
      let v;
      if (Object.prototype.hasOwnProperty.call(map, value)) v = map[value];
      else if (SAFE_VALUES.has(value.toLowerCase()) || (/^\d+$/.test(value) && +value <= 0x7FFF)) v = value;
      else return;
      try { storage.setItem(key, v); } catch (e) { /* cuota o bloqueado */ }
    };
  }
  S["set-local-storage-item"] = storageItem("localStorage");
  S["set-session-storage-item"] = storageItem("sessionStorage");

  function detectorStub() {
    const stub = {
      onDetected() { return stub; },
      onNotDetected(fn) {
        try { fn(); } catch { /* error del código de la página */ }
        return stub;
      },
      check() { return stub; }, emitEvent() { return stub; }, clearEvent() { return stub; }, setOption() { return stub; },
      on(det, fn) {
        if (!det) {
          try { fn(); } catch { /* error del código de la página */ }
        }
        return stub;
      }
    };
    return stub;
  }
  S["bab-defuser"] = function () {
    const stub = detectorStub();
    N.defineProperty(win, "blockAdBlock", { configurable: true, get() { return stub; }, set() {} });
    N.defineProperty(win, "BlockAdBlock", { configurable: true, get() { return function () { return stub; }; }, set() {} });
  };
  S["fuckadblock-defuser"] = function () {
    const stub = detectorStub();
    for (const n of ["fuckAdBlock", "sniffAdBlock", "blockAdBlock"]) {
      N.defineProperty(win, n, { configurable: true, get() { return stub; }, set() {} });
    }
    for (const n of ["FuckAdBlock", "SniffAdBlock", "BlockAdBlock"]) {
      N.defineProperty(win, n, { configurable: true, get() { return function () { return stub; }; }, set() {} });
    }
  };

  S["popads-dummy"] = function () {
    delete win.PopAds;
    delete win.popns;
    N.defineProperty(win, "PopAds", { value: {} });
    N.defineProperty(win, "popns", { value: {} });
  };

  S["href-sanitizer"] = function (selector, source) {
    if (!selector) return;
    const src = source || "text";
    const extract = a => {
      if (src === "text") return a.textContent.trim();
      if (src.startsWith("?")) {
        try { return new URL(a.href, location.href).searchParams.get(src.slice(1)) || ""; } catch (e) { return ""; }
      }
      const m = /^\[([^\]]+)\]$/.exec(src);
      return m ? a.getAttribute(m[1]) || "" : "";
    };
    const run = () => {
      for (const a of queryAll(selector)) {
        if (a.dataset.mbs === "1") continue;
        const url = extract(a);
        if (/^https?:\/\//.test(url)) { a.setAttribute("href", url); a.dataset.mbs = "1"; }
      }
    };
    onDomReady(() => observeDom(run, false));
  };

  // ---------- entrega de llamadas ----------

  function runAll(calls) {
    if (!Array.isArray(calls)) return;
    for (const call of calls) {
      if (!Array.isArray(call)) continue;
      const fn = S[call[0]];
      if (!fn) continue;
      try { fn(...call.slice(1).map(String)); } catch (e) { /* un scriptlet roto no debe romper la página */ }
    }
  }

  for (const key of KEYS) {
    if (Object.prototype.hasOwnProperty.call(win, key)) {
      const data = win[key];
      delete win[key];
      runAll(data);
      continue;
    }
    N.defineProperty(win, key, {
      configurable: true,
      get() { return undefined; },
      set(v) { delete win[key]; runAll(v); }
    });
  }
  onDomReady(() => { for (const key of KEYS) { try { delete win[key]; } catch (e) { /* nada */ } } });
})();
