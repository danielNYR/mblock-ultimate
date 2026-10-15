import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makePage, settle, closePages, ROOT } from "./helpers.mjs";

after(closePages);

// los arreglos vienen de la ventana jsdom: se comparan como JSON
const eq = (a, e) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), e);
const html = rel => readFileSync(new URL(rel, ROOT), "utf8");

function uiPage(rel, { url, browserOpts } = {}) {
  return makePage(html(rel), { url: url || "moz-extension://test/" + rel.replace("extension/", ""), runScripts: "outside-only", browserOpts });
}

// ---------- popup ----------

function popup(state) {
  const p = uiPage("extension/popup/popup.html", {
    browserOpts: { tabs: [{ id: 4, url: "https://news.test/" }], onSend: m => (m.type === "popupState" ? state : undefined) }
  });
  p.win.close = () => { p.closed = true; };
  p.load("extension/popup/popup.js");
  return p;
}

test("popup: muestra el sitio, contadores y sesión fantasma; acciones del usuario", async () => {
  const p = popup({ host: "news.test", enabled: true, siteEnabled: true, trusted: false, tabCount: 3, total: 120, phantom: "banner de cookies", cookieCount: 7 });
  await settle();
  const $ = id => p.doc.getElementById(id);
  assert.equal($("host").textContent, "news.test");
  assert.equal($("tabCount").textContent, "3");
  assert.equal($("total").textContent, "120");
  assert.equal($("phantom").hidden, false);
  assert.equal($("phantomReason").textContent, "banner de cookies");
  assert.match($("cookies").textContent, /7/);
  assert.equal($("siteToggle").checked, true);

  $("addTrusted").click();
  await settle();
  assert.ok(p.mock.calls.sent.some(m => m.type === "addTrusted" && m.host === "news.test"));
  $("options").click();
  await settle();
  assert.equal(p.mock.calls.options, 1);
  $("siteToggle").checked = false;
  $("siteToggle").dispatchEvent(new p.win.Event("change"));
  await settle();
  assert.ok(p.mock.calls.sent.some(m => m.type === "toggleSite"));
  assert.deepEqual(p.mock.calls.reloads, [4]);
  assert.ok(p.closed);
});

test("popup: página interna y sitio de confianza", async () => {
  const p = popup({ host: "", enabled: true, siteEnabled: false, trusted: true, tabCount: 0, total: 0, phantom: "", cookieCount: 0 });
  await settle();
  const $ = id => p.doc.getElementById(id);
  assert.equal($("host").textContent, "(página interna)");
  assert.equal($("siteToggle").disabled, true);
  assert.equal($("trustedNote").hidden, false);
  assert.equal($("cookies").textContent, "");
  assert.equal($("addTrusted").disabled, true);
});

// ---------- opciones ----------

function options(store = {}, onSend) {
  const p = uiPage("extension/options/options.html", { browserOpts: { store, onSend } });
  for (const f of ["lib/domain.js", "lib/defaults.js", "lib/lists.js", "options/options.js"]) p.load("extension/" + f);
  return p;
}

test("opciones: carga ajustes, catálogo de listas con estado y Mis filtros", async () => {
  const p = options({
    lists: { "ubo-filters": false },
    customListUrls: ["https://mi.lista/x.txt"],
    customBlock: ["||mio.test^", "mio.test##.x"],
    cookieLimit: 33,
    totalBlocked: 9,
    listMeta: { easylist: { updated: Date.UTC(2026, 9, 14), error: null }, phishing: { error: "HTTP 500" } },
    listStats: { easylist: { network: 10, cosmetic: 5, ignored: 2 }, user: { network: 1, cosmetic: 1, ignored: 1, scriptlets: 1 } }
  });
  await settle();
  const $ = id => p.doc.getElementById(id);
  assert.equal($("total").textContent, "9");
  assert.equal(p.doc.querySelector("input[data-key=cookieLimit]").value, "33");
  assert.equal(p.doc.querySelector("input[data-key=adBlock]").checked, true);
  assert.equal($("customBlock").value, "||mio.test^\nmio.test##.x");
  assert.equal($("customListUrls").value, "https://mi.lista/x.txt");
  const rows = [...p.doc.querySelectorAll("#catalog .list")].map(r => r.textContent);
  assert.ok(rows.some(t => t.includes("EasyList") && t.includes("15 filtros (2 no soportados)")));
  assert.ok(rows.some(t => t.includes("Phishing") && t.includes("error: HTTP 500")));
  assert.ok(rows.some(t => t.includes("https://mi.lista/x.txt")));
  assert.match($("listsInfo").textContent, /Mis filtros: 3 activos, 1 no soportados/);
  const ubo = [...p.doc.querySelectorAll("#catalog .list")].find(r => r.textContent.startsWith("uBlock filters")).querySelector("input");
  assert.equal(ubo.checked, false);
});

test("opciones: cambiar interruptores, listas y guardar", async () => {
  const p = options({}, m => (m.type === "updateLists" ? 4 : undefined));
  await settle();
  const $ = id => p.doc.getElementById(id);
  const gpc = p.doc.querySelector("input[data-key=gpc]");
  gpc.checked = false;
  gpc.dispatchEvent(new p.win.Event("change"));
  const limit = p.doc.querySelector("input[data-key=cookieLimit]");
  limit.value = "abc";
  limit.dispatchEvent(new p.win.Event("change"));
  await settle();
  assert.equal(p.mock.store.gpc, false);
  assert.equal(p.mock.store.cookieLimit, 20, "valor inválido -> valor por defecto");

  const first = p.doc.querySelector("#catalog .list input");
  first.checked = false;
  first.dispatchEvent(new p.win.Event("change"));
  await settle();
  assert.equal(Object.values(p.mock.store.lists)[0], false);

  $("allowlist").value = "Ejemplo.com, *.otro.test\nhttps://tercero.test/ruta";
  $("disabledSites").value = "malo.test";
  $("customBlock").value = "  ||a.test^  \n\n! comentario";
  $("customListUrls").value = "https://ok.test/l.txt http://inseguro.test/l.txt";
  $("save").click();
  await settle();
  eq(p.mock.store.allowlist, ["ejemplo.com", "otro.test", "tercero.test"]);
  eq(p.mock.store.disabledSites, ["malo.test"]);
  eq(p.mock.store.customBlock, ["||a.test^", "! comentario"]);
  eq(p.mock.store.customListUrls, ["https://ok.test/l.txt"]);
  assert.equal($("status").textContent, "Guardado");

  $("updateLists").click();
  await settle();
  assert.match($("status").textContent, /4 listas actualizadas/);
  $("resetStats").click();
  await settle();
  assert.ok(p.mock.calls.sent.some(m => m.type === "resetStats"));
  await p.mock.browser.storage.local.set({ listStats: { user: { network: 2, cosmetic: 0, ignored: 0 } } });
  await settle();
  assert.match($("listsInfo").textContent, /Mis filtros: 2 activos$/);
});

test("opciones: error al actualizar listas", async () => {
  const p = options({}, m => { if (m.type === "updateLists") throw new Error("sin red"); });
  await settle();
  p.doc.getElementById("updateLists").click();
  await settle();
  assert.match(p.doc.getElementById("status").textContent, /Error al actualizar: sin red/);
});

// ---------- página de advertencia ----------

function blocked(query) {
  const p = uiPage("extension/blocked/blocked.html", { url: "moz-extension://test/blocked/blocked.html?" + query });
  p.load("extension/blocked/blocked.js");
  return p;
}

test("advertencia: muestra URL, filtro y lista; 'continuar' habilita el sitio", async () => {
  const p = blocked(new URLSearchParams({ url: "https://phish.test/login", rule: "||phish.test^", list: "Phishing" }));
  const $ = id => p.doc.getElementById(id);
  assert.equal($("url").textContent, "https://phish.test/login");
  assert.equal($("rule").textContent, "||phish.test^");
  assert.equal($("list").textContent, "Phishing");
  $("proceed").click();
  await settle();
  assert.ok(p.mock.calls.sent.some(m => m.type === "strictBypass" && m.host === "phish.test"));
  $("back").click();
  await settle();
  assert.deepEqual(p.mock.calls.removed, [99], "sin historial cierra la pestaña");
});

test("advertencia: URL inválida o no web no continúa", async () => {
  for (const url of ["no es url", "javascript:alert(1)"]) {
    const p = blocked(new URLSearchParams({ url }));
    p.doc.getElementById("proceed").click();
    await settle();
    assert.equal(p.mock.calls.sent.length, 0);
  }
  const empty = blocked("");
  assert.equal(empty.doc.getElementById("url").textContent, "");
});
