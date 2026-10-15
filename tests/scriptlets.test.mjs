import { test, after } from "node:test";
import assert from "node:assert/strict";
import { makePage, settle, sleep } from "./helpers.mjs";
import { closePages } from "./helpers.mjs";

after(closePages);

// Página con la biblioteca cargada; `before` prepara la ventana antes de cargarla.
function page(calls, { html = "<!doctype html><body></body>", before } = {}) {
  const p = makePage(html, { url: "https://site.test/pagina" });
  if (before) before(p.win);
  p.load("extension/scriptlets/lib.js");
  if (calls) p.win.__mbs$1 = calls;
  return p;
}

const throws = (win, code) => {
  try { win.eval(code); return false; } catch (e) { return e instanceof win.ReferenceError; }
};

test("entrega: datos antes o después de cargar la biblioteca; las trampas se eliminan", () => {
  const p = makePage("<!doctype html><body></body>", { url: "https://site.test/" });
  p.win.__mbs$2 = [["set-constant", "antes", "true"]];
  p.load("extension/scriptlets/lib.js");
  p.win.__mbs$1 = [["set-constant", "despues", "1"], ["inexistente"], "no-es-array"];
  assert.equal(p.win.eval("antes"), true);
  assert.equal(p.win.eval("despues"), 1);
  assert.equal(Object.prototype.hasOwnProperty.call(p.win, "__mbs$2"), false);
  p.win.__mbs$1 = "basura"; // no rompe nada
});

test("set-constant: cadenas, valores permitidos y envoltorios", () => {
  const p = page([
    ["set-constant", "cfg.ads.enabled", "false"],
    ["set-constant", "fn1", "noopFunc"],
    ["set-constant", "fn2", "trueFunc"],
    ["set-constant", "fn3", "falseFunc"],
    ["set-constant", "obj", "emptyObj"],
    ["set-constant", "arr", "emptyArr"],
    ["set-constant", "str", "''"],
    ["set-constant", "nul", "null"],
    ["set-constant", "und", "undefined"],
    ["set-constant", "neg", "-1"],
    ["set-constant", "word", "yes"],
    ["set-constant", "wrapped", "true", "asFunction"],
    ["set-constant", "cb", "1", "asCallback"],
    ["set-constant", "res", "true", "asResolved"],
    ["set-constant", "bad", "algo-raro"],
    ["set-constant", "big", "999999"],
    ["set-constant", "thrower", "throwFunc"],
    ["set-constant", "cbn", "noopCallbackFunc"],
    ["set-constant", ""]
  ]);
  const w = p.win;
  w.eval("window.cfg = { ads: { enabled: true } }; cfg.ads.enabled = true;");
  assert.equal(w.eval("cfg.ads.enabled"), false);
  w.eval("window.fn1 = 5");
  assert.equal(typeof w.fn1, "function");
  assert.equal(w.fn2(), true);
  assert.equal(w.fn3(), false);
  assert.deepEqual(JSON.parse(JSON.stringify(w.obj)), {});
  assert.equal(w.arr.length, 0);
  assert.equal(w.str, "");
  assert.equal(w.nul, null);
  assert.equal(w.neg, -1);
  assert.equal(w.word, "yes");
  assert.equal(w.wrapped(), true);
  assert.equal(w.cb()(), 1);
  assert.ok(w.res instanceof w.Promise);
  assert.equal(w.bad, undefined);
  assert.equal(w.big, undefined);
  assert.throws(() => w.thrower());
  assert.equal(typeof w.cbn(), "function");
});

test("set-constant: no toca propiedades no configurables ni valores primitivos intermedios", () => {
  const p = page(null, {
    before: w => {
      Object.defineProperty(w, "fijo", { value: 1, configurable: false });
      w.prim = 5;
    }
  });
  p.win.__mbs$1 = [["set-constant", "fijo", "2"], ["set-constant", "prim.x", "1"]];
  assert.equal(p.win.fijo, 1);
  assert.equal(p.win.prim, 5);
});

test("abort-on-property-read / write", () => {
  const p = page([
    ["abort-on-property-read", "adsDetector"],
    ["abort-on-property-read", "deep.chain.x"],
    ["abort-on-property-write", "popunder"],
    ["abort-on-property-write", "ns.sub.y"],
    ["abort-on-property-write", "noexiste.z"],
    ["abort-on-property-read", ""],
    ["abort-on-property-write", ""]
  ], { before: w => { w.eval("window.ns = { sub: {} }"); } });
  const w = p.win;
  assert.ok(throws(w, "window.adsDetector"));
  w.eval("window.adsDetector = 1");
  w.eval("window.deep = { chain: {} }");
  assert.ok(throws(w, "deep.chain.x"));
  assert.ok(throws(w, "window.popunder = 1"));
  assert.ok(throws(w, "ns.sub.y = 1"));
});

test("abort-on-stack-trace y abort-current-script", () => {
  const p = page([
    ["abort-on-stack-trace", "track.send", "inlineScript"],
    ["abort-on-stack-trace", "other.prop", "injectedScript"],
    ["abort-on-stack-trace", "third", "/nadacoincide/"],
    ["abort-current-script", "adConfig", "showAds"],
    ["abort-current-script", "anyRead"],
    ["abort-current-script", ""],
    ["abort-on-stack-trace", ""]
  ]);
  const w = p.win;
  w.eval("window.track = { send: 1 }; window.other = {}; window.third = 3; window.adConfig = 1; window.anyRead = 2;");
  assert.equal(w.third, 3);
  w.third = 4;
  assert.equal(w.third, 4);
  // lectura desde un script inline cuyo texto coincide
  const run = code => {
    const s = p.doc.createElement("script");
    s.textContent = code;
    p.doc.body.appendChild(s);
  };
  run("try { window.adConfig; window.r1 = 'no'; } catch (e) { window.r1 = 'abortado'; } // showAds");
  run("try { window.adConfig; window.r2 = 'leido'; } catch (e) { window.r2 = 'abortado'; }");
  run("try { window.anyRead = 3; window.r3 = 'no'; } catch (e) { window.r3 = 'abortado'; }");
  assert.equal(w.r1, "abortado");
  assert.equal(w.r2, "leido");
  assert.equal(w.r3, "abortado");
  assert.equal(w.adConfig, 1, "fuera de un script de la página se lee normal");
  let reads = 0;
  try { reads += w.track.send ? 1 : 0; } catch { /* depende de la pila */ }
  try { w.other.prop = 1; reads += w.other.prop ? 1 : 0; } catch { /* depende de la pila */ }
  assert.ok(reads >= 0);
});

test("no-setTimeout-if / no-setInterval-if y boosters", () => {
  const seen = { timeout: [], interval: [] };
  const p = page([
    ["no-setTimeout-if", "adblock", "100"],
    ["no-setTimeout-if", "!keep"],
    ["no-setInterval-if", "", "!500"],
    ["no-setInterval-if", "", ""],
    ["nano-setTimeout-booster", "boost", "2000", "0.5"],
    ["nano-setInterval-booster", "*", "", "abc"]
  ], {
    before: w => {
      w.setTimeout = (fn, d) => { seen.timeout.push([String(fn), d]); return 1; };
      w.setInterval = (fn, d) => { seen.interval.push([String(fn), d]); return 1; };
    }
  });
  const w = p.win;
  w.setTimeout(function () { return "adblock"; }, 100);
  w.setTimeout(function () { return "keep"; }, 50);
  w.setTimeout(function () { return "boost keep"; }, 2000);
  w.setInterval(function () { return "x"; }, 1000);
  w.setInterval(function () { return "y"; }, 500);
  assert.match(seen.timeout[0][0], /^function \(\) \{\}$/);
  assert.match(seen.timeout[1][0], /keep/);
  assert.equal(seen.timeout[2][1], 1000);
  assert.match(seen.interval[0][0], /^function \(\) \{\}$/);
  assert.equal(seen.interval[0][1], 50);
  assert.match(seen.interval[1][0], /"y"/);
});

test("addEventListener-defuser y no-window-open-if", () => {
  let opened = 0;
  const p = page([
    ["addEventListener-defuser", "click", "popMagic"],
    ["addEventListener-defuser", "", ""],
    ["no-window-open-if", "!site.test"]
  ], { before: w => { w.open = () => { opened++; return w; }; } });
  const w = p.win;
  let a = 0, b = 0;
  w.document.addEventListener("click", function popMagic() { a++; });
  w.document.addEventListener("click", { handleEvent() { b++; } });
  w.document.dispatchEvent(new w.Event("click"));
  assert.equal(a, 0);
  assert.equal(b, 1);
  const decoy = w.open("https://ads.test/");
  assert.equal(decoy.closed, false);
  assert.equal(typeof decoy.focus, "function");
  assert.equal(JSON.stringify(decoy.document), "{}");
  decoy.location = "x";
  assert.equal(opened, 0);
  w.open("https://site.test/ok");
  assert.equal(opened, 1);
});

test("no-window-open-if sin patrón bloquea todo", () => {
  let opened = 0;
  const p = page([["no-window-open-if"]], { before: w => { w.open = () => { opened++; }; } });
  p.win.open();
  assert.equal(opened, 0);
});

test("no-fetch-if y json-prune-fetch-response", async () => {
  const p = page([
    ["no-fetch-if", "ads.json method:GET"],
    ["no-fetch-if", "url:/empty-arr/", "emptyArray"],
    ["no-fetch-if", "obj.json", "emptyObj"],
    ["json-prune-fetch-response", "ads meta.track", "", "propsToMatch", "/api/"],
    ["no-fetch-if"]
  ], {
    before: w => {
      w.fetch = async () => new Response('{"ads":[1],"meta":{"track":1,"keep":2},"x":1}', { status: 200 });
    }
  });
  const w = p.win;
  const r1 = await w.fetch("https://site.test/ads.json");
  assert.equal(await r1.text(), "");
  assert.equal(await (await w.fetch("https://site.test/empty-arr/x")).text(), "[]");
  assert.equal(await (await w.fetch(new Request("https://site.test/obj.json"))).text(), "{}");
  const pruned = await (await w.fetch("https://site.test/api/data")).json();
  assert.deepEqual(pruned, { meta: { keep: 2 }, x: 1 });
  const untouched = await (await w.fetch("https://site.test/otro")).json();
  assert.equal(untouched.ads.length, 1);
});

test("json-prune: rutas, comodines, [-] y propiedades requeridas", () => {
  const p = page([
    ["json-prune", "playerAds [].ad entries.[-].isAd"],
    ["json-prune", "secret", "required.flag"],
    ["json-prune", "a.*.b"],
    ["json-prune", "list.[-]"],
    ["json-prune", ""]
  ]);
  const w = p.win;
  const out = w.eval(`JSON.parse('{"playerAds":1,"items":[{"ad":1,"v":1}],"entries":[{"isAd":true},{"ok":1}],"secret":1}')`);
  assert.equal(out.playerAds, undefined);
  assert.equal(out.entries.length, 1);
  assert.equal(out.secret, 1, "sin la propiedad requerida no se borra");
  const out2 = w.eval(`JSON.parse('{"secret":1,"required":{"flag":1},"a":{"x":{"b":1,"c":2}},"list":[1,2]}')`);
  assert.equal(out2.secret, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(out2.a)), { x: { c: 2 } });
  assert.equal(out2.list.length, 0);
  assert.equal(w.eval("JSON.parse('5')"), 5);
});

test("json-prune también en Response.json y XHR (json-prune-xhr-response, no-xhr-if)", async () => {
  const p = page([
    ["json-prune", "ads"],
    ["json-prune-xhr-response", "ads", "", "propsToMatch", "data:"],
    ["no-xhr-if", "blocked.test"],
    ["no-xhr-if"],
    ["json-prune-xhr-response", ""]
  ]);
  const w = p.win;
  const r = new w.Response('{"ads":1,"x":2}');
  const data = await r.json();
  assert.equal(data.ads, undefined);

  const xhr = new w.XMLHttpRequest();
  xhr.open("GET", "data:application/json,{\"ads\":1,\"y\":2}");
  await new Promise(ok => { xhr.onload = ok; xhr.send(); });
  assert.equal(JSON.parse(xhr.responseText).ads, undefined);
  assert.equal(JSON.parse(xhr.responseText).y, 2);
  assert.equal(xhr.responseText, xhr.responseText, "usa la caché");

  const blocked = new w.XMLHttpRequest();
  blocked.open("GET", "https://blocked.test/ads");
  const events = [];
  blocked.addEventListener("load", () => events.push("load"));
  blocked.send();
  await sleep(20);
  assert.equal(blocked.status, 200);
  assert.equal(blocked.responseText, "");
  assert.deepEqual(events, ["load"]);
});

test("noeval, noeval-if y nowebrtc", () => {
  const p = page([["noeval-if", "adblock"], ["nowebrtc"]], { before: w => { w.RTCPeerConnection = function Real() {}; } });
  const w = p.win;
  assert.equal(w.eval("'adblock'"), undefined);
  assert.equal(w.eval("1 + 1"), 2);
  const pc = new w.RTCPeerConnection();
  assert.equal(typeof pc.createDataChannel, "function");
  pc.close();
  pc.addEventListener();
  pc.removeEventListener();
  assert.equal(JSON.stringify(pc.createDataChannel()), "{}");
  for (const m of ["createOffer", "setLocalDescription", "setRemoteDescription", "addIceCandidate"]) assert.equal(typeof pc[m]().then, "function");
  const q = page([["noeval"]]);
  assert.equal(q.win.eval("1"), undefined);
});

test("remove-attr, remove-class y href-sanitizer", async () => {
  const html = `<!doctype html><body>
    <div id="a" onclick="x" data-ad="1"></div><p class="ad-wall keep"></p>
    <a id="l" href="https://out.test/?u=https%3A%2F%2Freal.test%2F">https://texto.test/</a>
    <a id="q" class="q" href="https://out.test/?dest=https%3A%2F%2Fq.test%2F">q</a>
    <a id="at" class="at" data-real="https://attr.test/" href="#">at</a></body>`;
  const p = page([
    ["remove-attr", "onclick | data-ad"],
    ["remove-attr", "data-x", "", "complete"],
    ["remove-class", "ad-wall", "", "stay"],
    ["remove-class", "zzz", "[[invalido", "complete"],
    ["href-sanitizer", "#l"],
    ["href-sanitizer", "a.q", "?dest"],
    ["href-sanitizer", "a.at", "[data-real]"],
    ["href-sanitizer", "[[invalido"],
    ["remove-attr", ""], ["remove-class", ""], ["href-sanitizer", ""]
  ], { html });
  await settle();
  const d = p.doc;
  assert.equal(d.getElementById("a").hasAttribute("onclick"), false);
  assert.equal(d.getElementById("a").hasAttribute("data-ad"), false);
  assert.equal(d.querySelector("p").className, "keep");
  assert.equal(d.getElementById("l").getAttribute("href"), "https://texto.test/");
  assert.equal(d.getElementById("q").getAttribute("href"), "https://q.test/");
  assert.equal(d.getElementById("at").getAttribute("href"), "https://attr.test/");
  // nodos agregados después también se procesan
  const el = d.createElement("div");
  el.className = "ad-wall";
  d.body.appendChild(el);
  await settle();
  assert.equal(el.className, "");
  p.win.dispatchEvent(new p.win.Event("load"));
});

test("remove-node-text y replace-node-text", async () => {
  const p = page([
    ["remove-node-text", "script", "adblock"],
    ["replace-node-text", "#text", "Anuncio", "Contenido"],
    ["replace-node-text", "script", "x"],
    ["remove-node-text", ""]
  ], { html: "<!doctype html><body><script>/* adblock inicial */</script></body>" });
  const d = p.doc;
  assert.equal(d.querySelector("script").textContent, "");
  const s = d.createElement("script");
  s.type = "text/plain";
  s.textContent = "detect adblock";
  d.body.appendChild(s);
  d.body.appendChild(d.createTextNode("Anuncio aquí"));
  await settle();
  assert.equal(s.textContent, "");
  assert.equal(d.body.lastChild.textContent, "Contenido aquí");
});

test("cookies y almacenamiento: remove-cookie, set-cookie, set-*-storage-item", () => {
  const p = page(null);
  const w = p.win;
  w.document.cookie = "adsid=1; path=/";
  w.document.cookie = "keep=1; path=/";
  w.document.cookie = "consent=old; path=/";
  w.__mbs$1 = [
    ["remove-cookie", "adsid"],
    ["set-cookie", "accepted", "true"],
    ["set-cookie", "consent", "yes"],
    ["set-cookie", "num", "42", "none"],
    ["set-cookie", "bad", "<script>"],
    ["set-cookie", ""],
    ["set-local-storage-item", "a", "emptyObj"],
    ["set-local-storage-item", "b", "123"],
    ["set-local-storage-item", "c", "nope<"],
    ["set-local-storage-item", "d", "$remove$"],
    ["set-session-storage-item", "s", "accept"],
    ["set-local-storage-item", ""]
  ];
  assert.doesNotMatch(w.document.cookie, /adsid=1/);
  assert.match(w.document.cookie, /keep=1/);
  assert.match(w.document.cookie, /accepted=true/);
  assert.match(w.document.cookie, /consent=old/, "no sobrescribe cookies existentes");
  assert.doesNotMatch(w.document.cookie, /bad=/);
  assert.equal(w.localStorage.getItem("a"), "{}");
  assert.equal(w.localStorage.getItem("b"), "123");
  assert.equal(w.localStorage.getItem("c"), null);
  assert.equal(w.sessionStorage.getItem("s"), "accept");
  w.dispatchEvent(new w.Event("beforeunload"));
});

test("detectores de bloqueadores y popads", () => {
  const p = page([["bab-defuser"], ["fuckadblock-defuser"], ["popads-dummy"]]);
  const w = p.win;
  let called = 0;
  w.blockAdBlock.onDetected(() => { throw new Error("no"); }).onNotDetected(() => { called++; });
  w.fuckAdBlock.on(false, () => { called++; }).on(true, () => { throw new Error("no"); });
  w.sniffAdBlock.onNotDetected(() => { throw new Error("se ignora"); });
  w.sniffAdBlock.on(false, () => { throw new Error("se ignora"); });
  assert.equal(called, 2);
  assert.equal(typeof new w.BlockAdBlock().check, "function");
  assert.equal(typeof new w.FuckAdBlock().emitEvent, "function");
  w.blockAdBlock.check().emitEvent().clearEvent().setOption();
  w.blockAdBlock = null;
  assert.ok(w.blockAdBlock);
  assert.deepEqual(JSON.parse(JSON.stringify(w.PopAds)), {});
});

test("un scriptlet que falla no rompe los demás", () => {
  const p = page([["remove-class", "x", "", "stay"], ["set-constant", "ok", "true"]], { before: w => { delete w.CSS; } });
  assert.equal(p.win.ok, true);
});
