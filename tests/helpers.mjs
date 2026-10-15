// Utilidades de prueba: cargan los scripts clásicos de la extensión en
// contextos aislados (vm o jsdom) con una API `browser` simulada. Los scripts
// se compilan con su ruta real para que cuenten en la cobertura.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import implUtils from "jsdom/lib/generated/idl/utils.js";

export const ROOT = new URL("../", import.meta.url);

export function runFile(ctx, rel) {
  const url = new URL(rel, ROOT);
  new vm.Script(readFileSync(url, "utf8"), { filename: url.href }).runInContext(ctx);
}

export const tick = () => new Promise(r => setImmediate(r));
export async function settle(n = 20) {
  for (let i = 0; i < n; i++) await tick();
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeEvent(listeners, name) {
  return {
    addListener: fn => {
      if (!listeners[name]) listeners[name] = [];
      listeners[name].push(fn);
    },
    removeListener: fn => { listeners[name] = (listeners[name] || []).filter(f => f !== fn); },
    hasListener: fn => (listeners[name] || []).includes(fn)
  };
}

function pick(store, keys) {
  if (keys === null || keys === undefined) return { ...store };
  const list = Array.isArray(keys) ? keys : [keys];
  const out = {};
  for (const k of list) if (k in store) out[k] = store[k];
  return out;
}

// API `browser` simulada. opts: {store, tabs, tabGet, cookies, onSend, filterResponseData}
export function makeBrowser(opts = {}) {
  const listeners = {};
  const ev = name => makeEvent(listeners, name);
  const store = { ...(opts.store || {}) };
  const calls = {
    insertCSS: [], removed: [], updated: [], badge: [], sent: [], cookiesRemoved: [], localStorage: [],
    registered: [], unregistered: 0, scripting: [], reloads: [], options: 0, created: []
  };
  const fire = (name, ...args) => (listeners[name] || []).map(fn => fn(...args));
  const browser = {
    storage: {
      local: {
        get: async keys => pick(store, keys),
        set: async obj => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
          fire("storage", changes, "local");
        },
        remove: async keys => { for (const k of [].concat(keys)) delete store[k]; }
      },
      onChanged: ev("storage")
    },
    tabs: {
      query: async () => opts.tabs || [],
      get: async id => (opts.tabGet ? opts.tabGet(id) : { id }),
      remove: async id => { calls.removed.push(id); },
      update: async (id, o) => { calls.updated.push([id, o]); },
      insertCSS: async (id, o) => { calls.insertCSS.push({ id, ...o }); },
      reload: async id => { calls.reloads.push(id); },
      create: async o => { calls.created.push(o); return { id: 500 }; },
      getCurrent: async () => ({ id: 99 }),
      onCreated: ev("tabCreated"),
      onRemoved: ev("tabRemoved")
    },
    browserAction: {
      setBadgeText: async o => { calls.badge.push(o); },
      setBadgeBackgroundColor: () => {}
    },
    webRequest: {
      onBeforeRequest: ev("beforeRequest"),
      onHeadersReceived: ev("headersReceived"),
      onBeforeSendHeaders: ev("beforeSendHeaders"),
      filterResponseData: id => (opts.filterResponseData ? opts.filterResponseData(id) : {})
    },
    webNavigation: { onCommitted: ev("committed") },
    runtime: {
      onMessage: ev("message"),
      getURL: p => "moz-extension://test/" + p,
      sendMessage: async m => { calls.sent.push(m); return opts.onSend ? opts.onSend(m) : undefined; },
      openOptionsPage: async () => { calls.options++; }
    },
    alarms: { create: () => {}, onAlarm: ev("alarm") },
    cookies: {
      getAllCookieStores: async () => [{ id: "firefox-default" }],
      getAll: async q => (opts.cookies ? opts.cookies(q) : []),
      remove: async d => { calls.cookiesRemoved.push(d); }
    },
    browsingData: { removeLocalStorage: async o => { calls.localStorage.push(o); } },
    contentScripts: {
      register: async o => {
        if (opts.registerFails && opts.registerFails(o)) throw new Error("patrón inválido");
        calls.registered.push(o);
        return { unregister: async () => { calls.unregistered++; } };
      }
    },
    scripting: {
      getRegisteredContentScripts: async () => calls.scripting.filter(x => x.live),
      registerContentScripts: async arr => { for (const x of arr) calls.scripting.push({ ...x, live: true }); },
      unregisterContentScripts: async () => { for (const x of calls.scripting) x.live = false; }
    }
  };
  return { browser, listeners, store, calls, fire };
}

export function listener(mock, event, name) {
  return (mock.listeners[event] || []).find(f => f.name === name) || (mock.listeners[event] || [])[0];
}

// Carga el background completo. opts.fetch: (url) => texto | null
export async function loadBackground(opts = {}) {
  const mock = makeBrowser(opts);
  const errors = [];
  const fetch = async url => {
    const body = opts.fetch ? opts.fetch(url) : null;
    if (body === null || body === undefined) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => body };
  };
  const ctx = vm.createContext({
    browser: mock.browser, fetch, URL, URLSearchParams, setTimeout, clearTimeout, TextDecoder, TextEncoder,
    console: { error: (...a) => errors.push(a), log() {}, warn() {} }
  });
  for (const f of ["lib/domain.js", "lib/defaults.js", "lib/lists.js", "lib/filters.js", "background.js"]) {
    runFile(ctx, "extension/" + f);
  }
  await vm.runInContext("engineReady", ctx);
  await settle(40);
  const get = expr => vm.runInContext(expr, ctx);
  const message = (msg, sender = {}) => mock.listeners.message[0](msg, sender);
  return { ...mock, ctx, get, errors, message, beforeRequest: listener(mock, "beforeRequest", "onBeforeRequest") };
}

const openPages = [];
// Cierra las ventanas jsdom (y sus temporizadores) creadas por makePage.
export function closePages() {
  while (openPages.length) openPages.pop().close();
}

// Página simulada con jsdom y las APIs de content script de Firefox.
export function makePage(html, { url = "https://site.test/", browserOpts = {}, runScripts = "dangerously" } = {}) {
  const mock = makeBrowser(browserOpts);
  const dom = new JSDOM(html, { url, runScripts, pretendToBeVisual: true });
  const win = dom.window;
  openPages.push(win);
  win.browser = mock.browser;
  win.wrappedJSObject = win;
  win.exportFunction = (fn, target, o) => {
    if (o && o.defineAs) target[o.defineAs] = fn;
    return fn;
  };
  win.cloneInto = x => x;
  if (!win.CSS) win.CSS = {};
  if (!win.CSS.escape) win.CSS.escape = s => String(s).replace(/[^\w-]/g, "\\$&");
  for (const k of ["fetch", "Response", "Request", "Headers"]) if (!win[k]) win[k] = globalThis[k];
  // jsdom no calcula layout: todo elemento visible mide 100x20
  win.Element.prototype.getBoundingClientRect = function () {
    const hidden = this.style && (this.style.display === "none" || this.style.width === "0px");
    const size = hidden ? { width: 0, height: 0 } : { width: Number(this.dataset.w || 100), height: Number(this.dataset.h || 20) };
    return { x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, ...size };
  };
  win.document.elementsFromPoint = () => [];
  // jsdom no implementa innerText: texto visible aproximado
  if (!("innerText" in win.HTMLElement.prototype)) {
    Object.defineProperty(win.HTMLElement.prototype, "innerText", {
      configurable: true,
      get() { return this.style.display === "none" ? "" : this.textContent; }
    });
  }
  win.HTMLMediaElement.prototype.play = function () { this._paused = false; return Promise.resolve(); };
  const ctx = dom.getInternalVMContext();
  const load = rel => runFile(ctx, rel);
  return { dom, win, doc: win.document, mock, ctx, load };
}

// Despacha un evento "de confianza" (como si lo hubiera generado el usuario):
// dispatchEvent() de jsdom siempre marca isTrusted=false, así que se usa la vía interna.
export function dispatchTrusted(win, target, type, init = {}) {
  const Ctor = type.includes("click") || type === "contextmenu" ? win.MouseEvent : win.Event;
  const e = new Ctor(type, { bubbles: true, cancelable: true, ...init });
  const impl = implUtils.implForWrapper(e);
  impl.isTrusted = true;
  implUtils.implForWrapper(target)._dispatch(impl);
  return e;
}
