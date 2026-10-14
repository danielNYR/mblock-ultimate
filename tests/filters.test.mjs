import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.siteOf = require("../extension/lib/domain.js").siteOf;
const { FilterEngine, ftBestToken } = require("../extension/lib/filters.js");

const LIST = `
! comentario
[Adblock Plus 2.0]
||ads.example^
||tracker.example^$third-party
||cdn.example/ads/
/banner/*/img^
-ad-300x250.
|https://exact.example/path|
||scripts.example^$script
||noimg.example^$~image
||shop.example^$domain=foo.com|~bar.foo.com
||important.example^$important
@@||important.example^
@@||ads.example/allowed/
@@||safe.example^$document
@@||plain.example^$elemhide
@@||nogeneric.example^$generichide
||popup.example^$popup
||csp.example^$csp=script-src 'none'
/regex-ad\\d+/
0.0.0.0 hosts.example
plain-domain.example
||bad.example^
||bad.example^$badfilter
##.ad-box
##div[id^="sponsor-"]
example.com##.only-here
~example.com,other.com##.not-on-example
google.*##.entity-ad
example.com#@#.ad-box
example.com##.styled:style(opacity: 0 !important)
example.com##.gone:remove()
##+js(set-constant, x, 1)
example.com##.proc:has-text(Ad)
##.evil{} body{display:none
`;

const e = FilterEngine.fromLists([{ id: "t", text: LIST }]);
const m = (url, type = "script", docHost = "page.test") => {
  const host = new URL(url).hostname;
  const r = e.match({ url, host, type, docHost, thirdParty: siteOf(host) !== siteOf(docHost) });
  return r ? r.raw : null;
};

test("bloqueo por dominio y subdominio", () => {
  assert.equal(m("https://ads.example/x.js"), "||ads.example^");
  assert.equal(m("https://a.b.ads.example/x.js"), "||ads.example^");
  assert.equal(m("https://notads.example/x.js"), null);
});

test("formatos hosts y dominio plano", () => {
  assert.ok(m("https://hosts.example/"));
  assert.ok(m("https://sub.plain-domain.example/"));
});

test("$third-party y tipos", () => {
  assert.ok(m("https://tracker.example/p.gif", "image"));
  assert.equal(m("https://tracker.example/p.gif", "image", "tracker.example"), null);
  assert.ok(m("https://scripts.example/a.js", "script"));
  assert.equal(m("https://scripts.example/a.png", "image"), null);
  assert.equal(m("https://noimg.example/a.png", "image"), null);
  assert.ok(m("https://noimg.example/a.js", "script"));
});

test("patrones de ruta, comodines, separadores, anclas y regex", () => {
  assert.ok(m("https://cdn.example/ads/a.js"));
  assert.equal(m("https://cdn.example/assets/a.js"), null);
  assert.ok(m("https://x.test/banner/123/img?x"));
  assert.ok(m("https://x.test/static/top-ad-300x250.png", "image"));
  assert.ok(m("https://exact.example/path"));
  assert.equal(m("https://exact.example/path2"), null);
  assert.ok(m("https://x.test/regex-ad42.js"));
});

test("$domain= con exclusiones", () => {
  assert.ok(m("https://shop.example/a.js", "script", "www.foo.com"));
  assert.equal(m("https://shop.example/a.js", "script", "bar.foo.com"), null);
  assert.equal(m("https://shop.example/a.js", "script", "other.com"), null);
});

test("excepciones e $important", () => {
  assert.equal(m("https://ads.example/allowed/a.js"), null);
  assert.ok(m("https://important.example/a.js"));
});

test("$badfilter anula el filtro y las opciones no soportadas se ignoran", () => {
  assert.equal(m("https://bad.example/a.js"), null);
  assert.equal(m("https://csp.example/"), null);
  assert.ok(e.stats.t.ignored >= 4);
});

test("documento: solo bloquean filtros de dominio sin tipo", () => {
  assert.ok(m("https://ads.example/", "document", "ads.example"));
  assert.equal(m("https://scripts.example/", "document", "scripts.example"), null);
  assert.equal(m("https://cdn.example/ads/", "document", "cdn.example"), null);
});

test("popups", () => {
  assert.ok(m("https://popup.example/", "popup", "streaming.test"));
  assert.equal(m("https://popup.example/x.js"), null);
  assert.equal(m("https://ads.example/", "popup", "streaming.test"), null);
});

test("excepciones de página", () => {
  assert.deepEqual(e.pageFlags("https://safe.example/", "safe.example"), { document: true, elemhide: false, generichide: false });
  assert.equal(e.pageFlags("https://plain.example/", "plain.example").elemhide, true);
  assert.equal(e.pageFlags("https://nogeneric.example/", "nogeneric.example").generichide, true);
  assert.equal(e.pageFlags("https://other.test/", "other.test").document, false);
});

test("cosmético específico, entidades, excepciones y :style", () => {
  const ex = e.cosmeticCss("www.example.com");
  assert.match(ex, /\.only-here\{display:none!important\}/);
  assert.match(ex, /\.styled\{opacity: 0 !important\}/);
  assert.match(ex, /\.gone\{display:none/);
  assert.doesNotMatch(ex, /not-on-example/);
  assert.match(ex, /div\[id\^="sponsor-"\]/);
  assert.match(e.cosmeticCss("other.com"), /not-on-example/);
  assert.match(e.cosmeticCss("www.google.com.mx"), /entity-ad/);
  assert.doesNotMatch(e.cosmeticCss("google-fake.com"), /entity-ad/);
  assert.equal(e.cosmeticCss("plain.example", { elemhide: true }), "");
  assert.doesNotMatch(e.cosmeticCss("x.test", { generichide: true }), /sponsor-/);
});

test("cosmético genérico por tokens respeta excepciones y bloquea inyección CSS", () => {
  assert.match(e.genericCss("x.test", ["c:ad-box", "c:other"]), /\.ad-box/);
  assert.equal(e.genericCss("example.com", ["c:ad-box"]), "");
  assert.doesNotMatch(e.cosmeticCss("x.test") + e.genericCss("x.test", ["c:evil"]), /body/);
  assert.doesNotMatch(e.cosmeticCss("example.com"), /has-text|set-constant/);
});

test("token de indexación seguro", () => {
  assert.equal(ftBestToken("/banner/*/img^"), "banner");
  assert.equal(ftBestToken("-ad-300x250."), "300x250");
  assert.equal(ftBestToken("adser*"), "");
});

test("scriptlets: alias, argumentos con comillas y comas, AdGuard, excepciones y confianza", () => {
  const s = FilterEngine.fromLists([
    { id: "ubo-filters", text: [
      "example.com,~sub.example.com##+js(set, a.b, true)",
      "example.com##+js(aopr, adblock)",
      "x.com##+js(rpnt, script, \"a,b\", 'c')",
      "y.com##+js(nostif, /ad\\,block/, 3000)",
      "##+js(nowoif)",
      "google.*##+js(aeld, click, pop)",
      "example.com#@#+js(aopr, adblock)",
      "other.com#@#+js()",
      "z.com#%#//scriptlet('ubo-aeld.js', 'click', 'popMagic')",
      "w.com##+js(no-such-scriptlet, 1)"
    ].join("\n") },
    { id: "easylist", text: "q.com##+js(rpnt, script, a, b)" }
  ]);
  const d = s.scriptletData();
  assert.deepEqual(d.specific["example.com"], [["set-constant", "a.b", "true"], ["abort-on-property-read", "adblock"]]);
  assert.deepEqual(d.specific["x.com"], [["replace-node-text", "script", "a,b", "c"]]);
  assert.deepEqual(d.specific["y.com"], [["no-setTimeout-if", "/ad,block/", "3000"]]);
  assert.deepEqual(d.specific["z.com"], [["addEventListener-defuser", "click", "popMagic"]]);
  assert.deepEqual(d.generic, [["no-window-open-if"]]);
  assert.deepEqual(d.entity["google.*"], [["addEventListener-defuser", "click", "pop"]]);
  assert.ok(d.exc["sub.example.com"].includes("set-constant\u0001a.b\u0001true"));
  assert.ok(d.exc["example.com"].includes("abort-on-property-read\u0001adblock"));
  assert.deepEqual(d.exc["other.com"], ["*"]);
  assert.equal(d.specific["w.com"], undefined);
  assert.equal(d.specific["q.com"], undefined, "rpnt solo desde listas de confianza");
  assert.equal(s.stats["ubo-filters"].scriptlets, 9);
});
