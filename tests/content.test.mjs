import { test, after } from "node:test";
import assert from "node:assert/strict";
import { makePage, dispatchTrusted, settle, sleep } from "./helpers.mjs";
import { closePages } from "./helpers.mjs";

after(closePages);

const STATE = {
  active: true, trusted: false, topHost: "stream.test", adBlock: true, redirectGuard: true,
  youtube: true, facebook: true, blockNotifications: true, consentAuto: true, phantomAccept: true,
  gpc: true, elemhide: false, generichide: false, allowlist: ["google.com", "youtube.com"]
};

function contentPage(html, { state = STATE, url = "https://stream.test/ver", before } = {}) {
  const p = makePage(html, { url, browserOpts: { onSend: m => (m.type === "getState" ? { ...state } : undefined) } });
  if (before) before(p.win);
  return p;
}

const sentTypes = p => p.mock.calls.sent.map(m => m.type);

// ---------- guard.js ----------

function guardPage(html = "<!doctype html><body></body>", opts = {}) {
  let opened = [];
  const p = contentPage(html, {
    ...opts,
    before: w => {
      w.open = url => { opened.push(url); return { url }; };
      w.Notification = { requestPermission: async () => "granted" };
      w.PushManager = function () {};
      w.PushManager.prototype.subscribe = async () => "suscrito";
      if (opts.before) opts.before(w);
    }
  });
  p.load("extension/lib/domain.js");
  p.load("extension/lib/defaults.js");
  p.load("extension/content/guard.js");
  return { ...p, opened };
}

test("guard: window.open solo hacia el mismo sitio, dominios seguros o about:blank", async () => {
  const p = guardPage();
  await settle();
  assert.equal(p.win.open("https://ads.malo.test/"), null);
  p.win.open("https://cdn.stream.test/x");
  p.win.open("https://accounts.google.com/");
  p.win.open("about:blank");
  p.win.open("javascript:void 0");
  p.win.open("http://[bad");
  assert.deepEqual(p.opened, ["https://cdn.stream.test/x", "https://accounts.google.com/", "about:blank", "javascript:void 0", "http://[bad"]);
  assert.ok(sentTypes(p).includes("blocked"));
});

test("guard: en un sitio de confianza o desactivado no interviene", async () => {
  const p = guardPage(undefined, { state: { ...STATE, trusted: true } });
  await settle();
  p.win.open("https://otro.test/");
  assert.deepEqual(p.opened, ["https://otro.test/"]);
});

test("guard: niega notificaciones push y expone Global Privacy Control", async () => {
  const p = guardPage();
  await settle();
  let cb;
  assert.equal(await p.win.Notification.requestPermission(r => { cb = r; }), "denied");
  assert.equal(cb, "denied");
  await assert.rejects(p.win.PushManager.prototype.subscribe());
  assert.equal(p.win.navigator.globalPrivacyControl, true);
  const q = guardPage(undefined, { state: { ...STATE, trusted: true, gpc: false } });
  await settle();
  assert.equal(await q.win.Notification.requestPermission(), "granted");
  assert.equal(await q.win.PushManager.prototype.subscribe(), "suscrito");
  assert.equal(q.win.navigator.globalPrivacyControl, false);
});

test("guard: clics del usuario en enlaces visibles avisan la intención; overlays invisibles se neutralizan", async () => {
  const p = guardPage(`<!doctype html><body>
    <a id="vis" href="https://otro.test/pelicula">Ver película</a>
    <a id="same" href="/capitulo-2">Capítulo 2</a>
    <a id="ghost" href="https://popads.test/x" style="opacity:0"></a>
    <a id="mail" href="mailto:a@b.test">correo</a>
    <form id="f" action="https://pago.test/checkout"></form></body>`);
  await settle();
  const d = p.doc;
  dispatchTrusted(p.win, d.getElementById("vis"), "click");
  dispatchTrusted(p.win, d.getElementById("same"), "click");
  dispatchTrusted(p.win, d.getElementById("mail"), "click");
  const ghost = dispatchTrusted(p.win, d.getElementById("ghost"), "click");
  dispatchTrusted(p.win, d.getElementById("ghost"), "contextmenu");
  dispatchTrusted(p.win, d.getElementById("f"), "submit");
  d.getElementById("vis").dispatchEvent(new p.win.MouseEvent("click", { bubbles: true })); // sintético: se ignora
  const intents = p.mock.calls.sent.filter(m => m.type === "intent").map(m => m.host);
  assert.deepEqual(intents, ["otro.test", "stream.test", "popads.test", "pago.test"]);
  assert.equal(ghost.defaultPrevented, true);
  assert.equal(d.getElementById("ghost").style.display, "none");
  assert.ok(sentTypes(p).includes("blocked"));
});

test("guard: enlaces vacíos que cubren el reproductor también se consideran sospechosos", async () => {
  const p = guardPage(`<!doctype html><body><a id="big" href="https://ads.test/" data-w="2000" data-h="2000"></a><a id="small" href="https://ok.test/" data-w="10" data-h="10"></a></body>`, {
    before: w => { w.HTMLAnchorElement.prototype.querySelector = () => null; }
  });
  await settle();
  const big = dispatchTrusted(p.win, p.doc.getElementById("big"), "click");
  assert.equal(big.defaultPrevented, true);
  p.doc.elementsFromPoint = () => [p.doc.createElement("video")];
  const small = dispatchTrusted(p.win, p.doc.getElementById("small"), "click");
  assert.equal(small.defaultPrevented, true);
});

test("guard: meta refresh hacia otro dominio se elimina", async () => {
  const p = guardPage();
  await settle();
  const meta = p.doc.createElement("meta");
  meta.httpEquiv = "refresh";
  meta.content = "0; url='https://redireccion.test/'";
  p.doc.head.appendChild(meta);
  const ok = p.doc.createElement("meta");
  ok.httpEquiv = "refresh";
  ok.content = "5; url=/misma-pagina";
  p.doc.head.appendChild(ok);
  await settle();
  assert.equal(meta.isConnected, false);
  assert.equal(ok.isConnected, true);
});

// ---------- consent.js ----------

function consentPage(banner, state = STATE) {
  const p = contentPage(`<!doctype html><body style="overflow:hidden"><h1>Contenido</h1>${banner}</body>`, { state });
  p.win.log = [];
  p.load("extension/content/consent.js");
  return p;
}

const consentResult = p => p.mock.calls.sent.filter(m => m.type === "consent").map(m => m.action);

test("consent: CMP conocido -> pulsa Rechazar", async () => {
  const p = consentPage(`<div id="onetrust-banner-sdk">Cookies <button id="onetrust-accept-btn-handler" onclick="log.push('a')">Aceptar</button><button id="onetrust-reject-all-handler" onclick="log.push('r')">Rechazar todo</button></div>`);
  await settle();
  assert.deepEqual(p.win.log, ["r"]);
  assert.deepEqual(consentResult(p), ["reject"]);
  await sleep(600);
  assert.equal(p.doc.body.style.overflow, "auto");
});

test("consent: banner genérico con 'Solo necesarias' y muro que solo deja aceptar", async () => {
  const a = consentPage(`<div role="dialog">Este sitio usa cookies. <button onclick="log.push('a')">Aceptar</button> <a href="#" onclick="log.push('r');return false">Solo necesarias</a></div>`);
  await settle();
  assert.deepEqual(a.win.log, ["r"]);
  const b = consentPage(`<div class="cookie-wall">Usamos cookies. <button onclick="log.push('a')">Aceptar todo</button> <button>Configurar</button></div>`);
  await settle();
  assert.deepEqual(b.win.log, ["a"]);
  assert.deepEqual(consentResult(b), ["accept"]);
});

test("consent: sin botones reconocibles oculta el banner y los fondos; sin 'aceptar fantasma' no acepta", async () => {
  const p = consentPage(`<div id="cookie-banner">Aviso de cookies <button>Más información</button></div><div class="modal-backdrop" style="position:fixed" data-w="5000" data-h="5000"></div>`);
  await settle();
  assert.equal(p.doc.getElementById("cookie-banner").style.display, "none");
  assert.equal(p.doc.querySelector(".modal-backdrop").style.display, "none");
  assert.deepEqual(consentResult(p), ["hide"]);
  const q = consentPage(`<div class="cookie-wall">Usamos cookies <button onclick="log.push('a')">Aceptar</button></div>`, { ...STATE, phantomAccept: false });
  await settle();
  assert.deepEqual(q.win.log, []);
  assert.deepEqual(consentResult(q), ["hide"]);
});

test("consent: diálogos que no son de cookies y sitios de confianza se respetan; banners tardíos se detectan", async () => {
  const p = consentPage(`<div role="dialog">Suscríbete al boletín <button onclick="log.push('a')">Aceptar</button></div>`);
  await settle();
  assert.deepEqual(p.win.log, []);
  const t = consentPage(`<div id="CybotCookiebotDialog"><button id="CybotCookiebotDialogBodyButtonDecline" onclick="log.push('r')">x</button></div>`, { ...STATE, trusted: true });
  await settle();
  assert.deepEqual(t.win.log, []);
  const late = consentPage("");
  await settle();
  late.doc.body.insertAdjacentHTML("beforeend", `<div class="cky-consent-container">Cookies <button class="cky-btn-reject" onclick="log.push('r')">No</button></div>`);
  await sleep(400);
  assert.deepEqual(late.win.log, ["r"]);
});

// ---------- cosmetic.js ----------

test("cosmetic: envía las clases e ids de la página, incluidos los que aparecen después", async () => {
  const p = contentPage(`<!doctype html><body><div id="ad-top" class="banner big"></div></body>`);
  p.load("extension/content/cosmetic.js");
  await settle();
  await sleep(150);
  const first = p.mock.calls.sent.find(m => m.type === "cosmeticTokens");
  assert.ok(first.tokens.includes("i:ad-top"));
  assert.ok(first.tokens.includes("c:banner"));
  const el = p.doc.createElement("span");
  el.className = "late-ad";
  p.doc.body.appendChild(el);
  p.doc.getElementById("ad-top").className = "banner changed";
  await settle();
  await sleep(150);
  const all = p.mock.calls.sent.filter(m => m.type === "cosmeticTokens").flatMap(m => m.tokens);
  assert.ok(all.includes("c:late-ad"));
  assert.ok(all.includes("c:changed"));
  assert.ok(p.mock.calls.sent.some(m => m.type === "getState" && m.css));
  const off = contentPage("<div class='x'></div>", { state: { ...STATE, generichide: true } });
  off.load("extension/content/cosmetic.js");
  await settle();
  await sleep(150);
  assert.ok(!off.mock.calls.sent.some(m => m.type === "cosmeticTokens"));
});

// ---------- youtube.js ----------

test("youtube: en modo anuncio silencia, adelanta y pulsa Omitir; luego restaura", async () => {
  const p = contentPage(`<!doctype html><body><div id="movie_player" class="html5-video-player"><video></video></div><button class="ytp-ad-skip-button">Omitir</button><button class="ytp-ad-overlay-close-button"></button></body>`, { url: "https://www.youtube.com/watch?v=1" });
  const video = p.doc.querySelector("video");
  let duration = 15;
  Object.defineProperty(video, "duration", { get: () => duration });
  video.currentTime = 0;
  video.muted = false;
  video.playbackRate = 1.25;
  let skips = 0;
  p.doc.querySelector(".ytp-ad-skip-button").addEventListener("click", () => skips++);
  p.load("extension/content/youtube.js");
  await settle();
  await sleep(250);
  const player = p.doc.getElementById("movie_player");
  player.classList.add("ad-showing");
  await settle();
  assert.equal(video.muted, true);
  assert.ok(video.currentTime > 14.8);
  assert.ok(skips >= 1);
  assert.ok(p.mock.calls.sent.some(m => m.type === "blocked"));
  duration = 3600; // stream cosido: se acelera en vez de saltar al final
  player.classList.add("ad-interrupting");
  await sleep(250);
  assert.equal(video.playbackRate, 16);
  player.classList.remove("ad-showing", "ad-interrupting");
  await settle();
  assert.equal(video.muted, false);
  assert.equal(video.playbackRate, 1.25);
});

test("youtube: desactivado por configuración no toca el reproductor", async () => {
  const p = contentPage(`<!doctype html><body><div id="movie_player" class="ad-showing"><video></video></div></body>`, { state: { ...STATE, youtube: false }, url: "https://www.youtube.com/" });
  const video = p.doc.querySelector("video");
  video.muted = false;
  p.load("extension/content/youtube.js");
  await settle();
  await sleep(250);
  assert.equal(video.muted, false);
});

// ---------- facebook.js ----------

test("facebook: oculta publicaciones patrocinadas y la columna 'Patrocinado'", async () => {
  const p = contentPage(`<!doctype html><body>
    <div role="feed">
      <div id="p1"><a href="https://www.facebook.com/ads/about">Info</a></div>
      <div id="p2"><span aria-label="Patrocinado"></span></div>
      <div id="p3"><a role="link">P a t r o c i n a d o</a></div>
      <div id="p4"><svg><use href="#lbl"></use></svg></div>
      <div id="p5">Publicación normal de un amigo</div>
    </div>
    <svg><text id="lbl">Sponsored</text></svg>
    <div data-pagelet="RightRail"><div><div id="rail"><h3>Patrocinado</h3></div></div></div>
  </body>`, { url: "https://www.facebook.com/" });
  p.load("extension/content/facebook.js");
  await settle();
  const hidden = id => p.doc.getElementById(id).style.display === "none";
  assert.ok(hidden("p1") && hidden("p2") && hidden("p3") && hidden("p4"));
  assert.ok(!hidden("p5"));
  assert.ok(hidden("rail"));
  const later = p.doc.createElement("div");
  later.innerHTML = `<a href="/ads/about">x</a>`;
  p.doc.querySelector("[role=feed]").appendChild(later);
  await sleep(450);
  assert.equal(later.style.display, "none");
});

// ---------- scriptlet-loader.js ----------

function loaderPage(url, setup) {
  const p = makePage("<!doctype html><body></body>", { url, runScripts: "outside-only" });
  setup(p.ctx);
  p.load("extension/content/scriptlet-loader.js");
  return p;
}

test("scriptlet-loader: entrega genéricos, entidades y específicos sin duplicados ni excepciones", () => {
  const data = {
    generic: [["no-window-open-if"]],
    entity: { "google.*": [["set-constant", "e", "1"]] },
    specific: { "google.com.mx": [["set-constant", "s", "1"], ["no-window-open-if"]], "www.google.com.mx": [["set-constant", "s", "1"]] },
    exc: { "www.google.com.mx": ["no-window-open-if"] },
    off: []
  };
  const p = loaderPage("https://www.google.com.mx/", ctx => { ctx.__mbsG = data; ctx.__mbsS = data; });
  assert.deepEqual(JSON.parse(JSON.stringify(p.win.__mbs$1)), [["set-constant", "e", "1"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(p.win.__mbs$2)), [["set-constant", "s", "1"]]);
});

test("scriptlet-loader: sitios desactivados, excepción total y páginas sin host", () => {
  const base = { generic: [["noeval"]], entity: {}, specific: {}, exc: {}, off: [] };
  const off = loaderPage("https://sub.apagado.test/", ctx => { ctx.__mbsG = { ...base, off: ["apagado.test"] }; });
  assert.equal(off.win.__mbs$1, undefined);
  const all = loaderPage("https://todo.test/", ctx => { ctx.__mbsG = { ...base, exc: { "todo.test": ["*"] } }; });
  assert.equal(all.win.__mbs$1, undefined);
  const blank = loaderPage("about:blank", ctx => { ctx.__mbsG = base; });
  assert.equal(blank.win.__mbs$1, undefined);
  const none = loaderPage("https://x.test/", () => {});
  assert.equal(none.win.__mbs$1, undefined);
});
