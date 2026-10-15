"use strict";

let settings = Object.assign({}, DEFAULT_SETTINGS);
let totalBlocked = 0;
let engine = null;               // FilterEngine compilado
let resolveEngineReady;
const engineReady = new Promise(r => { resolveEngineReady = r; });

const tabHosts = new Map();   // tabId -> host del documento principal
const tabOpener = new Map();  // tabId -> openerTabId
const intents = new Map();    // tabId -> {host, t}: clic real del usuario en un enlace visible
const tabCounts = new Map();  // tabId -> bloqueos en la página actual
const allowedRequests = new Set(); // requestId de navegaciones ya permitidas (cadenas de redirección)
const tabUrls = new Map();    // tabId -> URL del documento principal
const tabFlags = new Map();   // tabId -> excepciones de página ($document, $elemhide, $generichide)
const strictBypass = new Set(); // sitios que el usuario decidió abrir pese a la advertencia

const INTENT_MS = 5000;

// ---------- Estado ----------

async function loadState() {
  const s = await browser.storage.local.get(SETTING_KEYS.concat(["totalBlocked", "remoteListUrls"]));
  for (const k of SETTING_KEYS) if (s[k] !== undefined) settings[k] = s[k];
  totalBlocked = s.totalBlocked || 0;
  // Migración desde 1.1: las listas remotas personalizadas pasan a customListUrls
  if (s.remoteListUrls) {
    const extra = s.remoteListUrls.filter(u => !LIST_CATALOG.some(l => l.url === u));
    settings.customListUrls = [...new Set(settings.customListUrls.concat(extra))];
    await browser.storage.local.set({ customListUrls: settings.customListUrls });
    await browser.storage.local.remove(["remoteListUrls", "remoteDomains", "remoteList", "remoteUpdated", "remoteErrors"]);
  }
  const tabs = await browser.tabs.query({});
  for (const t of tabs) {
    const h = hostOf(t.url);
    if (h) { tabHosts.set(t.id, h); tabUrls.set(t.id, t.url); }
    if (t.openerTabId !== undefined) tabOpener.set(t.id, t.openerTabId);
  }
}

let rebuildTimer = null;
const REBUILD_KEYS = new Set(["customBlock"]);
const DOWNLOAD_KEYS = new Set(["lists", "customListUrls"]);
const SCRIPTLET_KEYS = new Set(["enabled", "adBlock", "scriptlets", "disabledSites"]);

function applySettingChanges(changes) {
  const changed = Object.keys(changes).filter(k => SETTING_KEYS.includes(k));
  for (const k of changed) {
    settings[k] = changes[k].newValue === undefined ? DEFAULT_SETTINGS[k] : changes[k].newValue;
  }
  return {
    rebuild: changed.some(k => REBUILD_KEYS.has(k)),
    download: changed.some(k => DOWNLOAD_KEYS.has(k)),
    rescript: changed.some(k => SCRIPTLET_KEYS.has(k))
  };
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const { rebuild, download, rescript } = applySettingChanges(changes);
  if (download) {
    updateLists(false).then(rebuildEngine).catch(() => {});
  } else if (rebuild) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuildEngine, 300);
  } else if (rescript) {
    registerScriptlets();
  }
});

function isSiteEnabled(host) {
  return settings.enabled && !!host && !hostInList(host, settings.disabledSites);
}

function isTrusted(host) {
  return hostInList(host, settings.allowlist);
}

// ---------- Contadores ----------

let saveTimer = null;
function countBlocked(tabId) {
  totalBlocked++;
  if (tabId >= 0) {
    const n = (tabCounts.get(tabId) || 0) + 1;
    tabCounts.set(tabId, n);
    browser.browserAction.setBadgeText({ tabId, text: String(n) }).catch(() => {});
  }
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      browser.storage.local.set({ totalBlocked });
    }, 2000);
  }
}

browser.browserAction.setBadgeBackgroundColor({ color: "#1565c0" });

// ---------- Bloqueo de red ----------

function flagsFor(tabId) {
  const none = { document: false, elemhide: false, generichide: false };
  if (!engine || tabId < 0) return none;
  if (!tabFlags.has(tabId)) tabFlags.set(tabId, engine.pageFlags(tabUrls.get(tabId), tabHosts.get(tabId)));
  return tabFlags.get(tabId);
}

function topHostFor(d) {
  return tabHosts.get(d.tabId) ||
    (d.frameAncestors && d.frameAncestors.length ? hostOf(d.frameAncestors[d.frameAncestors.length - 1].url) : "") ||
    hostOf(d.documentUrl || d.originUrl);
}

function onBeforeRequest(d) {
  if (d.tabId < 0) return {};
  if (d.type === "main_frame") return guardMainFrame(d);

  const host = hostOf(d.url);
  const topHost = topHostFor(d);
  if (!host || !topHost || !isSiteEnabled(topHost)) return {};

  // Un sitio público no debe hablar con localhost / la red local
  // (evita el aviso "quiere acceder a otras apps y servicios en este dispositivo").
  if (settings.localNetGuard && isPrivateHost(host) && !isPrivateHost(topHost) && !isTrusted(topHost)) {
    countBlocked(d.tabId);
    return { cancel: true };
  }

  if (!settings.adBlock) return {};
  if (!engine) return engineReady.then(() => onBeforeRequest(d));
  if (flagsFor(d.tabId).document) return {};
  const docHost = hostOf(d.documentUrl) || topHost;
  const rule = engine.match({ url: d.url, host, type: d.type, docHost, thirdParty: !sameSite(host, docHost) });
  if (rule) {
    countBlocked(d.tabId);
    return { cancel: true };
  }
  return {};
}

// Bloqueo estricto: abrir directamente un dominio/URL bloqueado (malware,
// phishing, redes de anuncios) muestra una página de advertencia.
async function strictCheck(d, target) {
  if (!settings.strictBlocking || !settings.adBlock || !isSiteEnabled(target) || isTrusted(target)) return null;
  if (strictBypass.has(siteOf(target))) return null;
  await engineReady;
  const rule = engine.match({ url: d.url, host: target, type: "document", docHost: target, thirdParty: false });
  if (!rule) return null;
  countBlocked(d.tabId);
  const page = browser.runtime.getURL("blocked/blocked.html") + "?" +
    new URLSearchParams({ url: d.url, rule: rule.raw, list: listName(rule.list) });
  return { redirectUrl: page };
}

function listName(id) {
  if (id === "builtin") return "Filtros integrados";
  if (id === "user") return "Mis filtros";
  const l = LIST_CATALOG.find(x => x.id === id);
  return l ? l.name : String(id || "").replace(/^custom:/, "");
}

// ---------- Guardia de redirecciones / pestañas nuevas ----------

function rememberAllowed(requestId) {
  allowedRequests.add(requestId);
  if (allowedRequests.size > 500) allowedRequests.delete(allowedRequests.values().next().value);
}

// ¿Desde qué pestaña/sitio se origina esta navegación? Una pestaña nueva sin
// historial se atribuye a la pestaña que la abrió.
async function navigationSource(tabId, origin) {
  const own = tabHosts.get(tabId);
  if (own) return { sourceTab: tabId, sourceHost: own, isNewTab: false };
  let opener = tabOpener.get(tabId);
  if (opener === undefined) {
    try {
      opener = (await browser.tabs.get(tabId)).openerTabId;
    } catch {
      // la pestaña ya se cerró
    }
  }
  if (opener === undefined) return { sourceTab: tabId, sourceHost: hostOf(origin), isNewTab: false };
  return { sourceTab: opener, sourceHost: tabHosts.get(opener) || hostOf(origin), isNewTab: true };
}

function blockNavigation(tabId, src) {
  countBlocked(src.sourceTab);
  if (src.isNewTab) {
    browser.tabs.remove(tabId).catch(() => {});
    browser.tabs.update(src.sourceTab, { active: true }).catch(() => {});
  }
  return { cancel: true };
}

// Filtros $popup de las listas (típicos de sitios de streaming)
function isListedPopup(d, target, src) {
  return src.isNewTab && settings.adBlock && !!engine &&
    !!engine.match({ url: d.url, host: target, type: "popup", docHost: src.sourceHost, thirdParty: !sameSite(target, src.sourceHost) });
}

function hasUserIntent(sourceTab, target) {
  const intent = intents.get(sourceTab);
  return !!intent && Date.now() - intent.t < INTENT_MS && sameSite(intent.host, target);
}

async function guardMainFrame(d) {
  const target = hostOf(d.url);
  if (!target) return {};
  const strict = await strictCheck(d, target);
  if (strict) return strict;

  if (allowedRequests.has(d.requestId)) return {};
  const allow = () => { rememberAllowed(d.requestId); return {}; };
  // Navegación iniciada por el navegador (barra de direcciones, marcadores, extensiones).
  const origin = d.originUrl || "";
  if (!settings.redirectGuard || !/^https?:/.test(origin)) return allow();

  const src = await navigationSource(d.tabId, origin);
  if (!src.sourceHost || !isSiteEnabled(src.sourceHost)) return allow();
  if (isListedPopup(d, target, src)) return blockNavigation(d.tabId, src);
  if (isTrusted(src.sourceHost) || sameSite(target, src.sourceHost) || isTrusted(target)) return allow();
  if (hasUserIntent(src.sourceTab, target)) return allow();
  return blockNavigation(d.tabId, src);
}

// ---------- YouTube: quitar anuncios de la respuesta del reproductor ----------
// Renombrar las claves equivale a borrarlas y funciona tanto en JSON como en el HTML inicial.

const YT_AD_KEYS = /"(adPlacements|playerAds|adSlots|adBreakHeartbeatParams|adBreakParams)"\s*:/g;

function stripYoutubeAds(d) {
  if (!settings.youtube || !isSiteEnabled(hostOf(d.url))) return {};
  const filter = browser.webRequest.filterResponseData(d.requestId);
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  let text = "";
  filter.ondata = e => { text += decoder.decode(e.data, { stream: true }); };
  filter.onstop = () => {
    text += decoder.decode();
    filter.write(encoder.encode(text.replace(YT_AD_KEYS, (m, k) => "\"__noad_" + k + "\":")));
    filter.close();
  };
  filter.onerror = () => { try { filter.disconnect(); } catch (e) { /* ya cerrado */ } };
  return {};
}

browser.webRequest.onBeforeRequest.addListener(
  stripYoutubeAds,
  {
    urls: [
      // player: datos del video; get_watch: player + next en una sola respuesta
      // (YouTube lo usa al navegar dentro del sitio); reel: Shorts
      "*://*.youtube.com/youtubei/v1/player*",
      "*://*.youtube.com/youtubei/v1/get_watch*",
      "*://*.youtube.com/youtubei/v1/next*",
      "*://*.youtube.com/youtubei/v1/reel/*",
      "*://www.youtube.com/watch*",
      "*://m.youtube.com/watch*",
      "*://www.youtube.com/shorts/*"
    ],
    types: ["main_frame", "xmlhttprequest"]
  },
  ["blocking"]
);

browser.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: ["<all_urls>"] }, ["blocking"]);

// ---------- Cookies fantasma ----------
// Un sitio entra en "sesión fantasma" si muestra un banner de cookies o pone
// demasiadas cookies. Desde entonces: sin cookies de terceros en esa pestaña y,
// al cerrarla (o salir del sitio), se borran sus cookies y su localStorage.

const phantomTabs = new Map();    // tabId -> {site, reason, hosts:Set}
const tabCookieStats = new Map(); // tabId -> {count, third:Set}
const pendingSites = new Map();   // site -> Set(hosts): sitios cuyos datos hay que borrar

function phantomEligible(topHost) {
  return settings.phantomCookies && !!topHost && isSiteEnabled(topHost) && !isTrusted(topHost) && !isPrivateHost(topHost);
}

async function savePhantomPending() {
  await browser.storage.local.set({ phantomPending: [...pendingSites.keys()] });
}

function markPhantom(tabId, topHost, reason) {
  if (!phantomEligible(topHost)) return;
  const site = siteOf(topHost);
  if (!pendingSites.has(site)) pendingSites.set(site, new Set());
  pendingSites.get(site).add(topHost);
  const cur = phantomTabs.get(tabId);
  if (cur && cur.site === site) return;
  phantomTabs.set(tabId, { site, reason });
  savePhantomPending();
}

function cookieUrl(c) {
  return (c.secure ? "https://" : "http://") + c.domain.replace(/^\./, "") + c.path;
}

async function wipeSite(site, hosts) {
  const queries = [];
  for (const store of await browser.cookies.getAllCookieStores()) {
    queries.push({ domain: site, storeId: store.id, firstPartyDomain: null, partitionKey: {} });
    for (const scheme of ["https", "http"]) {
      queries.push({ storeId: store.id, firstPartyDomain: null, partitionKey: { topLevelSite: scheme + "://" + site } });
    }
  }
  let removed = 0;
  for (const q of queries) {
    let cookies;
    try {
      cookies = await browser.cookies.getAll(q);
    } catch {
      continue; // almacén o partición no disponible
    }
    for (const c of cookies) {
      const details = { url: cookieUrl(c), name: c.name, storeId: c.storeId, firstPartyDomain: c.firstPartyDomain };
      if (c.partitionKey) details.partitionKey = c.partitionKey;
      try { await browser.cookies.remove(details); removed++; } catch (e) { /* ya no existe */ }
    }
  }
  const hostnames = [...new Set([site, "www." + site].concat(hosts || []))];
  try { await browser.browsingData.removeLocalStorage({ hostnames }); } catch (e) { /* no soportado */ }
  return removed;
}

async function wipeSiteIfUnused(site, exceptTabId) {
  if (!site) return;
  for (const [tabId, host] of tabHosts) {
    if (tabId !== exceptTabId && sameSite(host, site)) return; // sigue abierto en otra pestaña
  }
  const hosts = [...(pendingSites.get(site) || [])];
  pendingSites.delete(site);
  await wipeSite(site, hosts);
  await savePhantomPending();
}

function onHeadersReceived(d) {
  if (d.tabId < 0 || !d.responseHeaders) return {};
  const topHost = d.type === "main_frame" ? hostOf(d.url) : topHostFor(d);
  if (!phantomEligible(topHost)) return {};
  const isSetCookie = h => h.name.toLowerCase() === "set-cookie";
  const sets = d.responseHeaders.filter(isSetCookie);
  if (!sets.length) return {};

  const host = hostOf(d.url);
  const thirdParty = !sameSite(host, topHost);
  let st = tabCookieStats.get(d.tabId);
  if (!st) { st = { count: 0, third: new Set() }; tabCookieStats.set(d.tabId, st); }
  for (const h of sets) st.count += String(h.value || "").split("\n").filter(Boolean).length;
  if (thirdParty) st.third.add(siteOf(host));
  if (!phantomTabs.has(d.tabId) && (st.count > settings.cookieLimit || st.third.size > 5)) {
    markPhantom(d.tabId, topHost, "cookies excesivas (" + st.count + ")");
  }
  if (thirdParty && phantomTabs.has(d.tabId)) {
    return { responseHeaders: d.responseHeaders.filter(h => !isSetCookie(h)) };
  }
  return {};
}

function onBeforeSendHeaders(d) {
  if (d.tabId < 0) return {};
  const topHost = d.type === "main_frame" ? hostOf(d.url) : topHostFor(d);
  if (!topHost || !isSiteEnabled(topHost)) return {};
  let headers = d.requestHeaders;
  let changed = false;
  if (settings.gpc && !headers.some(h => h.name.toLowerCase() === "sec-gpc")) {
    headers = headers.concat({ name: "Sec-GPC", value: "1" });
    changed = true;
  }
  if (phantomTabs.has(d.tabId) && !sameSite(hostOf(d.url), topHost)) {
    headers = headers.filter(h => h.name.toLowerCase() !== "cookie");
    changed = true;
  }
  return changed ? { requestHeaders: headers } : {};
}

browser.webRequest.onHeadersReceived.addListener(onHeadersReceived, { urls: ["<all_urls>"] }, ["blocking", "responseHeaders"]);
browser.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, { urls: ["<all_urls>"] }, ["blocking", "requestHeaders"]);

// ---------- Seguimiento de pestañas ----------

browser.tabs.onCreated.addListener(tab => {
  if (tab.openerTabId !== undefined) tabOpener.set(tab.id, tab.openerTabId);
});

browser.tabs.onRemoved.addListener(tabId => {
  const site = siteOf(tabHosts.get(tabId) || "");
  phantomTabs.delete(tabId);
  tabCookieStats.delete(tabId);
  tabHosts.delete(tabId);
  if (pendingSites.has(site)) wipeSiteIfUnused(site, tabId);
  tabOpener.delete(tabId);
  tabUrls.delete(tabId);
  tabFlags.delete(tabId);
  intents.delete(tabId);
  tabCounts.delete(tabId);
});

browser.webNavigation.onCommitted.addListener(d => {
  if (d.frameId !== 0) return;
  const h = hostOf(d.url);
  const prevSite = siteOf(tabHosts.get(d.tabId) || "");
  if (prevSite && !sameSite(h, prevSite)) {
    phantomTabs.delete(d.tabId);
    tabCookieStats.delete(d.tabId);
    if (pendingSites.has(prevSite)) wipeSiteIfUnused(prevSite, d.tabId);
  } else if (!phantomTabs.has(d.tabId)) {
    tabCookieStats.delete(d.tabId);
  }
  if (h) tabHosts.set(d.tabId, h);
  tabUrls.set(d.tabId, d.url);
  tabFlags.delete(d.tabId);
  tabCounts.set(d.tabId, 0);
  browser.browserAction.setBadgeText({ tabId: d.tabId, text: "" }).catch(() => {});
});

// ---------- Mensajes ----------

function stateFor(topHost, tabId) {
  const flags = flagsFor(tabId);
  return {
    active: isSiteEnabled(topHost) && !flags.document,
    elemhide: flags.elemhide,
    generichide: flags.generichide,
    trusted: isTrusted(topHost),
    topHost,
    adBlock: settings.adBlock,
    redirectGuard: settings.redirectGuard,
    youtube: settings.youtube,
    facebook: settings.facebook,
    blockNotifications: settings.blockNotifications,
    consentAuto: settings.consentAuto,
    phantomAccept: settings.phantomAccept && settings.phantomCookies,
    gpc: settings.gpc,
    allowlist: settings.allowlist
  };
}

function topHostOf(tab) {
  return tabHosts.get(tab.id) || hostOf(tab.url);
}

const MESSAGE_HANDLERS = {
  getState(msg, sender) {
    const tab = sender.tab;
    if (!tab) return Promise.resolve(null);
    const topHost = topHostOf(tab);
    return engineReady.then(() => {
      const state = stateFor(topHost, tab.id);
      if (msg.css && state.active && settings.adBlock) {
        insertCss(tab.id, sender.frameId, engine.cosmeticCss(hostOf(sender.url) || topHost, flagsFor(tab.id)));
      }
      return state;
    });
  },
  cosmeticTokens(msg, sender) {
    const tab = sender.tab;
    if (!tab || !engine || !Array.isArray(msg.tokens)) return undefined;
    const host = hostOf(sender.url) || tabHosts.get(tab.id) || "";
    insertCss(tab.id, sender.frameId, engine.genericCss(host, msg.tokens, flagsFor(tab.id)));
    return undefined;
  },
  strictBypass(msg) {
    if (msg.host) strictBypass.add(siteOf(msg.host));
    return Promise.resolve();
  },
  intent(msg, sender) {
    if (sender.tab && msg.host) intents.set(sender.tab.id, { host: msg.host, t: Date.now() });
    return undefined;
  },
  blocked(msg, sender) {
    if (sender.tab) countBlocked(sender.tab.id);
    return undefined;
  },
  consent(msg, sender) {
    if (!sender.tab) return undefined;
    countBlocked(sender.tab.id);
    const reason = msg.action === "accept" ? "aceptado en modo fantasma" : "banner de cookies";
    markPhantom(sender.tab.id, topHostOf(sender.tab), reason);
    return undefined;
  },
  popupState(msg) {
    const host = tabHosts.get(msg.tabId) || "";
    const phantom = phantomTabs.get(msg.tabId);
    return Promise.resolve({
      host,
      enabled: settings.enabled,
      siteEnabled: isSiteEnabled(host),
      trusted: isTrusted(host),
      tabCount: tabCounts.get(msg.tabId) || 0,
      phantom: phantom ? phantom.reason : "",
      cookieCount: (tabCookieStats.get(msg.tabId) || { count: 0 }).count,
      total: totalBlocked
    });
  },
  toggleSite(msg) {
    const site = siteOf(msg.host);
    const list = settings.disabledSites.filter(e => siteOf(normalizeEntry(e)) !== site);
    if (list.length === settings.disabledSites.length) list.push(site);
    return browser.storage.local.set({ disabledSites: list });
  },
  addTrusted(msg) {
    const site = siteOf(msg.host);
    if (!site || settings.allowlist.includes(site)) return Promise.resolve();
    return browser.storage.local.set({ allowlist: settings.allowlist.concat(site) });
  },
  updateLists() {
    return updateLists(true);
  },
  resetStats() {
    totalBlocked = 0;
    return browser.storage.local.set({ totalBlocked: 0 });
  }
};

browser.runtime.onMessage.addListener((msg, sender) => {
  const handler = msg && Object.prototype.hasOwnProperty.call(MESSAGE_HANDLERS, msg.type) ? MESSAGE_HANDLERS[msg.type] : null;
  return handler ? handler(msg, sender) : undefined;
});

// ---------- Listas de filtros ----------
// Cada lista se guarda como texto en storage ("list:<id>") con sus metadatos en
// "listMeta". Se actualiza según su cabecera "! Expires:" (entre 6 h y 14 días).

function insertCss(tabId, frameId, code) {
  if (!code) return;
  browser.tabs.insertCSS(tabId, { code, frameId, runAt: "document_start", cssOrigin: "user" }).catch(() => {});
}

function activeLists() {
  const out = LIST_CATALOG
    .filter(l => (settings.lists[l.id] !== undefined ? settings.lists[l.id] : l.on))
    .map(l => ({ id: l.id, url: l.url }));
  for (const url of settings.customListUrls) out.push({ id: "custom:" + url, url });
  return out;
}

const HOUR_MS = 36e5;
const DAY_MS = 864e5;

function parseExpires(text) {
  const m = /^!\s*expires:\s*(\d+)\s*(day|hour)/im.exec(text.slice(0, 4000));
  if (!m) return 4 * DAY_MS;
  const unit = m[2].toLowerCase() === "hour" ? HOUR_MS : DAY_MS;
  return Math.min(Math.max(+m[1] * unit, 6 * HOUR_MS), 14 * DAY_MS);
}

async function downloadList(url) {
  const res = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if (text.length < 100 || /^\s*<(!doctype|html)/i.test(text)) throw new Error("respuesta no válida");
  return text;
}

let updating = null;
function updateLists(force) {
  if (!updating) updating = doUpdateLists(force).finally(() => { updating = null; });
  return updating;
}

async function doUpdateLists(force) {
  const meta = (await browser.storage.local.get("listMeta")).listMeta || {};
  let changed = 0;
  for (const l of activeLists()) {
    const m = meta[l.id];
    if (!force && m && m.updated && Date.now() < m.updated + m.expires) continue;
    if (!force && m && m.error && Date.now() - m.tried < 36e5) continue;
    try {
      const text = await downloadList(l.url);
      await browser.storage.local.set({ ["list:" + l.id]: text });
      meta[l.id] = { updated: Date.now(), expires: parseExpires(text), error: null };
      changed++;
    } catch (e) {
      meta[l.id] = Object.assign({}, m, { error: e.message, tried: Date.now() });
    }
  }
  await browser.storage.local.set({ listMeta: meta });
  if (changed) await rebuildEngine();
  return changed;
}

async function rebuildEngine() {
  try {
    const lists = activeLists();
    const stored = await browser.storage.local.get(lists.map(l => "list:" + l.id));
    const sources = [
      { id: "builtin", text: BUILTIN_FILTERS },
      { id: "user", text: settings.customBlock.join("\n") }
    ].concat(lists.map(l => ({ id: l.id, text: stored["list:" + l.id] || "" })));
    engine = FilterEngine.fromLists(sources);
    await browser.storage.local.set({ listStats: engine.stats });
  } catch (e) {
    console.error("MBlock: error al compilar las listas", e);
    if (!engine) engine = FilterEngine.fromLists([{ id: "builtin", text: BUILTIN_FILTERS }]);
  } finally {
    tabFlags.clear();
    resolveEngineReady(); // nunca dejar peticiones esperando
  }
  registerScriptlets();
}

// ---------- Scriptlets ----------
// scriptlets/lib.js se registra en el contexto de la página (world MAIN); los
// datos de cada sitio se entregan con content/scriptlet-loader.js, registrado
// junto con su configuración. Ambos corren en document_start, antes que los
// scripts del sitio, y no dependen de la CSP de la página.

const MAIN_SCRIPT_ID = "mblock-scriptlets";
let scriptletRegs = [];
let scriptletsVersion = 0;

function matchPatternFor(host) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes(".") ? `*://${host}/*` : `*://*.${host}/*`;
}

async function registerScriptlets() {
  const version = ++scriptletsVersion;
  for (const r of scriptletRegs) r.unregister().catch(() => {});
  scriptletRegs = [];
  const on = engine && settings.enabled && settings.adBlock && settings.scriptlets;
  try {
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: [MAIN_SCRIPT_ID] });
    if (!on && existing.length) await browser.scripting.unregisterContentScripts({ ids: [MAIN_SCRIPT_ID] });
    if (on && !existing.length) {
      await browser.scripting.registerContentScripts([{
        id: MAIN_SCRIPT_ID, matches: ["<all_urls>"], js: ["scriptlets/lib.js"],
        runAt: "document_start", allFrames: true, world: "MAIN", persistAcrossSessions: false
      }]);
    }
  } catch (e) {
    console.error("MBlock: no se pudo registrar la biblioteca de scriptlets", e);
    return;
  }
  if (!on) return;

  const d = engine.scriptletData();
  const off = settings.disabledSites.map(normalizeEntry).filter(Boolean);
  const loader = { file: "content/scriptlet-loader.js" };
  const base = { runAt: "document_start", allFrames: true };
  const regs = [];
  const register = async (matches, code) => {
    try {
      regs.push(await browser.contentScripts.register(Object.assign({ matches, js: [{ code }, loader] }, base)));
    } catch (e) {
      // algún patrón inválido: se registra para todos los sitios (el loader filtra por host)
      regs.push(await browser.contentScripts.register(Object.assign({ matches: ["<all_urls>"], js: [{ code }, loader] }, base)));
    }
  };
  try {
    await register(["<all_urls>"], "var __mbsG = " + JSON.stringify({ generic: d.generic, entity: d.entity, exc: d.exc, off }) + ";");
    const hosts = Object.keys(d.specific).filter(h => /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(h));
    if (hosts.length) {
      await register([...new Set(hosts.map(matchPatternFor))], "var __mbsS = " + JSON.stringify({ specific: d.specific, exc: d.exc, off }) + ";");
    }
  } catch (e) {
    console.error("MBlock: error al registrar scriptlets", e);
  }
  if (version !== scriptletsVersion) {
    for (const r of regs) r.unregister().catch(() => {});
    return;
  }
  scriptletRegs = regs;
}

browser.alarms.create("lists", { periodInMinutes: 60 });
browser.alarms.onAlarm.addListener(a => {
  if (a.name === "lists") updateLists(false).catch(() => {});
});

loadState().catch(e => console.error("MBlock: error al cargar el estado", e)).then(async () => {
  await rebuildEngine();
  const { phantomPending } = await browser.storage.local.get("phantomPending");
  for (const site of phantomPending || []) pendingSites.set(site, new Set());
  for (const site of phantomPending || []) wipeSiteIfUnused(site);
  updateLists(false).catch(() => {});
});
