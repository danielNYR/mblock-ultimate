import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const d = require("../extension/lib/domain.js");

// defaults.js y lists.js son scripts de navegador: se cargan en un contexto aislado.
const ctx = vm.createContext({ URL });
for (const f of ["domain.js", "defaults.js", "lists.js"]) {
  vm.runInContext(readFileSync(new URL(`../extension/lib/${f}`, import.meta.url), "utf8"), ctx);
}
const DEFAULT_SETTINGS = vm.runInContext("DEFAULT_SETTINGS", ctx);
const blockSet = vm.runInContext("new Set(BUILTIN_BLOCK_DOMAINS)", ctx);

test("siteOf agrupa subdominios y respeta TLD de dos niveles", () => {
  assert.equal(d.siteOf("www.ejemplo.com.mx"), "ejemplo.com.mx");
  assert.equal(d.siteOf("a.b.co.uk"), "b.co.uk");
  assert.equal(d.siteOf("cdn.futbol.org"), "futbol.org");
  assert.equal(d.siteOf("192.168.1.1"), "192.168.1.1");
});

test("allowlist incluye subdominios pero no dominios parecidos", () => {
  assert.ok(d.hostInList("accounts.google.com", DEFAULT_SETTINGS.allowlist));
  assert.ok(!d.hostInList("evilgoogle.com", DEFAULT_SETTINGS.allowlist));
  assert.ok(!d.hostInList("google.com.evil.net", DEFAULT_SETTINGS.allowlist));
});

test("lista de bloqueo detecta subdominios de redes de anuncios", () => {
  assert.ok(d.hostInSet("c.ads.doubleclick.net", blockSet));
  assert.ok(d.hostInSet("my.popads.net", blockSet));
  assert.ok(!d.hostInSet("example.com", blockSet));
});

test("isPrivateHost reconoce red local", () => {
  for (const h of ["localhost", "127.0.0.1", "192.168.1.254", "10.0.0.8", "172.20.1.1", "[::1]", "router.local", "169.254.1.1"]) {
    assert.ok(d.isPrivateHost(h), h);
  }
  for (const h of ["8.8.8.8", "172.32.0.1", "example.com", "localhost.example.com"]) {
    assert.ok(!d.isPrivateHost(h), h);
  }
});

test("parseDomainList acepta los tres formatos y descarta reglas complejas", () => {
  const text = [
    "! comentario", "# comentario", "ads.example.com", "0.0.0.0 tracker.example.net",
    "127.0.0.1 localhost", "||pop.example.org^", "||third.example.org^$third-party",
    "||path.example.org/ads^", "||opt.example.org^$script", "example.com##.ad", ""
  ].join("\n");
  assert.deepEqual(d.parseDomainList(text).sort(),
    ["ads.example.com", "pop.example.org", "third.example.org", "tracker.example.net"]);
});

test("los filtros integrados incluyen dominios, reglas de URL y cosméticos", () => {
  const f = vm.runInContext("BUILTIN_FILTERS", ctx);
  assert.match(f, /^\|\|doubleclick\.net\^$/m);
  assert.match(f, /^\|\|youtube\.com\/api\/stats\/ads$/m);
  assert.match(f, /^youtube\.com##ytd-ad-slot-renderer$/m);
  assert.match(f, /^##\.adsbygoogle$/m);
});

test("YouTube: CSS integrado oculta el video durante el anuncio sin parpadeo", () => {
  globalThis.siteOf = d.siteOf;
  const { FilterEngine } = require("../extension/lib/filters.js");
  const e = FilterEngine.fromLists([{ id: "builtin", text: vm.runInContext("BUILTIN_FILTERS", ctx) }]);
  const css = e.cosmeticCss("www.youtube.com");
  assert.match(css, /\.html5-video-player\.ad-showing video\{opacity: 0 !important\}/);
  assert.match(css, /\.ad-showing::after\{content: "MBlock Ultimate/);
  assert.doesNotMatch(e.cosmeticCss("example.com"), /ad-showing/);
});
