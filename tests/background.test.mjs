import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBackground, settle, sleep, listener } from "./helpers.mjs";

const PAGE = "https://news.test/articulo";
const LIST_TEXT = [
  "! Title: prueba",
  "! Expires: 2 days",
  "||ads.example^",
  "||popup.example^$popup",
  "||phish.example^",
  "news.test##.promo",
  "##.ad-box",
  "news.test##+js(set, adsOff, true)",
  "##+js(nowoif)"
].join("\n") + "\n" + Array.from({ length: 30 }, (_, i) => `||filler${i}.example^`).join("\n");

async function bg(opts = {}) {
  const b = await loadBackground({
    tabs: [{ id: 1, url: PAGE }],
    fetch: url => (url.includes("easylist.txt") ? LIST_TEXT : null),
    ...opts
  });
  listener(b, "committed")({ frameId: 0, tabId: 1, url: PAGE });
  return b;
}

// los objetos vienen de otro contexto vm: se comparan como JSON
const plain = value => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

let requestCounter = 0;
const req = (o) => ({ tabId: 1, requestId: "r" + (++requestCounter), documentUrl: PAGE, ...o });

test("arranque: compila listas descargadas, guarda metadatos y estadísticas", async () => {
  const b = await bg();
  assert.ok(b.store["list:easylist"].includes("||ads.example^"));
  assert.equal(b.store.listMeta.easylist.error, null);
  assert.equal(b.store.listMeta.easylist.expires, 2 * 864e5);
  assert.match(b.store.listMeta["peter-lowe"].error, /HTTP 404/);
  assert.ok(b.store.listStats.easylist.network > 30);
  assert.ok(b.store.listStats.builtin.network > 100);
});

test("red: bloquea anuncios de terceros, deja pasar el resto y cuenta en el icono", async () => {
  const b = await bg();
  assert.deepStrictEqual(plain(await b.beforeRequest(req({ type: "script", url: "https://cdn.ads.example/a.js" }))), { cancel: true });
  assert.deepStrictEqual(plain(await b.beforeRequest(req({ type: "script", url: "https://cdn.news.test/app.js" }))), {});
  assert.deepStrictEqual(plain(await b.beforeRequest({ tabId: -1, type: "script", url: "https://ads.example/a.js" })), {});
  assert.ok(b.calls.badge.some(x => x.tabId === 1 && x.text === "1"));
});

test("red local: un sitio público no puede llamar a localhost ni al router", async () => {
  const b = await bg();
  assert.deepStrictEqual(plain(await b.beforeRequest(req({ type: "xmlhttprequest", url: "http://192.168.1.1/api" }))), { cancel: true });
  b.store.localNetGuard = false;
  await b.browser.storage.local.set({ localNetGuard: false });
  assert.deepStrictEqual(plain(await b.beforeRequest(req({ type: "xmlhttprequest", url: "http://192.168.1.1/api" }))), {});
});

test("sitio desactivado o protección apagada: no se bloquea nada", async () => {
  const b = await bg();
  await b.browser.storage.local.set({ disabledSites: ["news.test"] });
  assert.deepStrictEqual(plain(await b.beforeRequest(req({ type: "script", url: "https://ads.example/a.js" }))), {});
  await b.browser.storage.local.set({ disabledSites: [], adBlock: false });
  assert.deepStrictEqual(plain(await b.beforeRequest(req({ type: "script", url: "https://ads.example/a.js" }))), {});
});

test("bloqueo estricto: advertencia al abrir phishing y opción de continuar", async () => {
  const b = await bg();
  const r = await b.beforeRequest(req({ type: "main_frame", url: "https://phish.example/login" }));
  assert.match(r.redirectUrl, /^moz-extension:\/\/test\/blocked\/blocked\.html\?url=/);
  assert.match(decodeURIComponent(r.redirectUrl), /rule=\|\|phish\.example\^/);
  await b.message({ type: "strictBypass", host: "phish.example" });
  assert.deepStrictEqual(plain(await b.beforeRequest(req({ type: "main_frame", url: "https://phish.example/login" }))), {});
  await b.browser.storage.local.set({ strictBlocking: false });
  assert.deepStrictEqual(plain(await b.beforeRequest(req({ type: "main_frame", url: "https://ads.example/" }))), {});
});

test("guardia: bloquea redirecciones a otros sitios salvo seguros, mismo sitio o clic del usuario", async () => {
  const b = await bg();
  const nav = (url, extra = {}) => b.beforeRequest(req({ type: "main_frame", url, originUrl: PAGE, ...extra }));
  assert.deepStrictEqual(plain(await nav("https://malo.test/")), { cancel: true });
  assert.deepStrictEqual(plain(await nav("https://www.news.test/otra")), {});
  assert.deepStrictEqual(plain(await nav("https://accounts.google.com/")), {});
  b.message({ type: "intent", host: "bueno.test" }, { tab: { id: 1 } });
  assert.deepStrictEqual(plain(await nav("https://bueno.test/")), {});
  // navegación del navegador (sin origen web): siempre permitida
  assert.deepStrictEqual(plain(await b.beforeRequest(req({ type: "main_frame", url: "https://malo.test/" }))), {});
  // cadenas de redirección de una navegación ya permitida
  const id = "chain";
  assert.deepStrictEqual(plain(await nav("https://www.news.test/x", { requestId: id })), {});
  assert.deepStrictEqual(plain(await nav("https://otro.test/", { requestId: id })), {});
});

test("guardia: pestañas nuevas abiertas por la página se cierran; filtros $popup también", async () => {
  const b = await bg({ tabGet: id => ({ id, openerTabId: id === 7 ? 1 : undefined }) });
  listener(b, "tabCreated")({ id: 5, openerTabId: 1 });
  const r = await b.beforeRequest({ tabId: 5, requestId: "p1", type: "main_frame", url: "https://malo.test/", originUrl: PAGE });
  assert.deepStrictEqual(plain(r), { cancel: true });
  assert.ok(b.calls.removed.includes(5));
  assert.deepStrictEqual(plain(b.calls.updated.at(-1)), [1, { active: true }]);
  // opener obtenido con tabs.get y regla $popup aunque el destino sea "seguro" para la guardia
  const r2 = await b.beforeRequest({ tabId: 7, requestId: "p2", type: "main_frame", url: "https://popup.example/", originUrl: PAGE });
  assert.deepStrictEqual(plain(r2), { cancel: true });
  assert.ok(b.calls.removed.includes(7));
  // con la guardia apagada se permite
  await b.browser.storage.local.set({ redirectGuard: false });
  assert.deepStrictEqual(plain(await b.beforeRequest({ tabId: 5, requestId: "p3", type: "main_frame", url: "https://malo.test/", originUrl: PAGE })), {});
});

test("YouTube: renombra las claves de anuncios en la respuesta del reproductor", async () => {
  const filters = [];
  const b = await bg({
    filterResponseData: () => {
      const f = { written: "", write(buf) { this.written += new TextDecoder().decode(buf); }, close() { this.closed = true; }, disconnect() { this.disc = true; } };
      filters.push(f);
      return f;
    }
  });
  const strip = listener(b, "beforeRequest", "stripYoutubeAds");
  strip({ requestId: "y", url: "https://www.youtube.com/youtubei/v1/player" });
  const f = filters[0];
  f.ondata({ data: new TextEncoder().encode('{"adPlacements":[1],"playerAds":[],') });
  f.ondata({ data: new TextEncoder().encode('"streamingData":{}}') });
  f.onstop();
  assert.equal(f.written, '{"__noad_adPlacements":[1],"__noad_playerAds":[],"streamingData":{}}');
  assert.ok(f.closed);
  f.onerror();
  assert.ok(f.disc);
  await b.browser.storage.local.set({ youtube: false });
  assert.deepStrictEqual(plain(strip({ requestId: "z", url: "https://www.youtube.com/watch?v=1" })), {});
  assert.equal(filters.length, 1);
});

test("cookies: GPC en todas las peticiones; sesión fantasma por exceso de cookies", async () => {
  const b = await bg({
    cookies: q => (q.domain === "news.test" ? [{ name: "a", domain: ".news.test", path: "/", secure: true, storeId: "firefox-default", firstPartyDomain: "", partitionKey: null }] : [])
  });
  const send = listener(b, "beforeSendHeaders");
  const recv = listener(b, "headersReceived");
  const out = send(req({ type: "script", url: "https://cdn.other.test/x.js", requestHeaders: [{ name: "Cookie", value: "id=1" }] }));
  assert.ok(out.requestHeaders.some(h => h.name === "Sec-GPC" && h.value === "1"));
  assert.ok(out.requestHeaders.some(h => h.name === "Cookie"), "sin sesión fantasma no se quitan cookies");

  const headers = Array.from({ length: 25 }, (_, i) => ({ name: "Set-Cookie", value: `c${i}=1` }));
  recv(req({ type: "main_frame", url: PAGE, responseHeaders: headers }));
  const st = await b.message({ type: "popupState", tabId: 1 });
  assert.match(st.phantom, /cookies excesivas \(25\)/);
  assert.equal(st.cookieCount, 25);

  const third = recv(req({ type: "image", url: "https://tracker.other.test/p.gif", responseHeaders: [{ name: "set-cookie", value: "t=1" }, { name: "Content-Type", value: "image/gif" }] }));
  assert.deepStrictEqual(plain(third.responseHeaders), [{ name: "Content-Type", value: "image/gif" }]);
  const out2 = send(req({ type: "script", url: "https://cdn.other.test/x.js", requestHeaders: [{ name: "Cookie", value: "id=1" }] }));
  assert.ok(!out2.requestHeaders.some(h => h.name === "Cookie"));

  // al cerrar la pestaña se borran cookies y localStorage del sitio
  listener(b, "tabRemoved")(1);
  await settle();
  assert.ok(b.calls.cookiesRemoved.some(c => c.name === "a" && c.url === "https://news.test/"));
  assert.ok(b.calls.localStorage.at(-1).hostnames.includes("news.test"));
  assert.deepStrictEqual(plain(b.store.phantomPending), []);
});

test("cookies: banner aceptado marca sesión fantasma; salir del sitio borra sus datos", async () => {
  const b = await bg({ cookies: q => (q.domain === "news.test" ? [{ name: "s", domain: "news.test", path: "/", secure: false, storeId: "x", partitionKey: { topLevelSite: "https://news.test" } }] : []) });
  b.message({ type: "consent", action: "accept" }, { tab: { id: 1, url: PAGE } });
  const st = await b.message({ type: "popupState", tabId: 1 });
  assert.equal(st.phantom, "aceptado en modo fantasma");
  assert.ok(st.total >= 1);
  listener(b, "committed")({ frameId: 0, tabId: 1, url: "https://otro.test/" });
  await settle();
  assert.ok(b.calls.cookiesRemoved.some(c => c.name === "s" && c.url === "http://news.test/" && c.partitionKey));
  // un sitio seguro nunca entra en sesión fantasma
  b.message({ type: "consent", action: "reject" }, { tab: { id: 1, url: "https://www.google.com/" } });
  listener(b, "committed")({ frameId: 0, tabId: 1, url: "https://www.google.com/" });
  b.message({ type: "consent", action: "reject" }, { tab: { id: 1, url: "https://www.google.com/" } });
  assert.equal((await b.message({ type: "popupState", tabId: 1 })).phantom, "");
});

test("mensajes: getState inyecta CSS cosmético y cosmeticTokens el genérico", async () => {
  const b = await bg();
  const state = await b.message({ type: "getState", css: true }, { tab: { id: 1, url: PAGE }, url: PAGE, frameId: 0 });
  assert.equal(state.active, true);
  assert.equal(state.topHost, "news.test");
  assert.ok(b.calls.insertCSS.some(c => c.code.includes(".promo{display:none!important}")));
  b.message({ type: "cosmeticTokens", tokens: ["c:ad-box", "c:nada"] }, { tab: { id: 1 }, url: PAGE, frameId: 0 });
  assert.ok(b.calls.insertCSS.some(c => c.code === ".ad-box{display:none!important}"));
  assert.equal(await b.message({ type: "getState" }, {}), null);
  assert.equal(b.message({ type: "desconocido" }, {}), undefined);
  b.message({ type: "blocked" }, { tab: { id: 1 } });
});

test("mensajes: activar/desactivar sitio, marcar seguro, reiniciar contador, actualizar listas", async () => {
  const b = await bg();
  await b.message({ type: "toggleSite", host: "www.news.test" });
  assert.deepStrictEqual(plain(b.store.disabledSites), ["news.test"]);
  await b.message({ type: "toggleSite", host: "news.test" });
  assert.deepStrictEqual(plain(b.store.disabledSites), []);
  await b.message({ type: "addTrusted", host: "m.nuevo.test" });
  assert.ok(b.store.allowlist.includes("nuevo.test"));
  await b.message({ type: "addTrusted", host: "nuevo.test" });
  assert.equal(b.store.allowlist.filter(x => x === "nuevo.test").length, 1);
  await b.message({ type: "resetStats" });
  assert.equal(b.store.totalBlocked, 0);
  const n = await b.message({ type: "updateLists" });
  assert.ok(n >= 1);
});

test("scriptlets: registra la biblioteca MAIN y los datos por sitio; se desregistra al apagar", async () => {
  const b = await bg();
  assert.ok(b.calls.scripting.some(s => s.id === "mblock-scriptlets" && s.world === "MAIN" && s.live));
  const generic = b.calls.registered.find(r => r.matches.includes("<all_urls>"));
  assert.match(generic.js[0].code, /^var __mbsG = /);
  assert.equal(generic.js[1].file, "content/scriptlet-loader.js");
  const specific = b.calls.registered.find(r => r.js[0].code.startsWith("var __mbsS"));
  assert.ok(specific.matches.includes("*://*.news.test/*"));
  await b.browser.storage.local.set({ scriptlets: false });
  await settle();
  assert.ok(!b.calls.scripting.some(s => s.live));
  assert.ok(b.calls.unregistered >= 2);
});

test("scriptlets: si un patrón es inválido se registra para todos los sitios", async () => {
  const b = await bg({ registerFails: o => o.matches.some(m => m.includes("news.test")) });
  assert.ok(b.calls.registered.some(r => r.js[0].code.startsWith("var __mbsS") && r.matches[0] === "<all_urls>"));
});

test("listas: personalizadas, errores de descarga, alarmas y Mis filtros", async () => {
  const b = await bg({
    fetch: url => {
      if (url.includes("easylist.txt")) return LIST_TEXT;
      if (url.includes("html.test")) return "<!doctype html><html>" + "x".repeat(200);
      return null;
    }
  });
  await b.browser.storage.local.set({ customListUrls: ["https://html.test/lista.txt"] });
  await settle(60);
  assert.match(b.store.listMeta["custom:https://html.test/lista.txt"].error, /no válida/);
  await b.browser.storage.local.set({ lists: { easylist: false } });
  await settle(60);
  assert.equal(b.store.listStats.easylist, undefined);
  await b.browser.storage.local.set({ customBlock: ["||mio.example^"] });
  await sleep(350);
  await settle();
  assert.equal(b.store.listStats.user.network, 1);
  assert.deepStrictEqual(plain(await b.beforeRequest(req({ type: "image", url: "https://mio.example/x.png" }))), { cancel: true });
  listener(b, "alarm")({ name: "lists" });
  listener(b, "alarm")({ name: "otra" });
});

test("migración desde 1.1: listas remotas personalizadas pasan a customListUrls", async () => {
  const b = await bg({
    store: { remoteListUrls: ["https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext", "https://mi.lista/x.txt"], remoteDomains: ["a.com"] }
  });
  assert.deepStrictEqual(plain(b.store.customListUrls), ["https://mi.lista/x.txt"]);
  assert.equal(b.store.remoteListUrls, undefined);
});

test("sesiones fantasma pendientes de un cierre anterior se limpian al iniciar", async () => {
  const b = await bg({ store: { phantomPending: ["viejo.test"] }, cookies: q => (q.domain === "viejo.test" ? [{ name: "v", domain: "viejo.test", path: "/", secure: true, storeId: "x" }] : []) });
  await settle();
  assert.ok(b.calls.cookiesRemoved.some(c => c.name === "v"));
});
