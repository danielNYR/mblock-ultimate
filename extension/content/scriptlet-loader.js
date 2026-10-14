// Calcula qué scriptlets aplican a este sitio y se los entrega, en el mismo
// instante (document_start), a scriptlets/lib.js que corre en el contexto de la
// página. Los datos llegan en variables que el background registra junto con
// este archivo: __mbsG (genéricos + entidades, todos los sitios) y __mbsS
// (específicos, solo en los sitios que tienen alguno).
"use strict";

(() => {
  const host = location.hostname;
  if (!host) return;
  const SECOND_LEVEL = new Set(["com", "net", "org", "gov", "gob", "edu", "ac", "co", "or", "ne", "go", "mil", "nom"]);

  const candidates = [];
  for (let h = host; h;) {
    candidates.push(h);
    const i = h.indexOf(".");
    if (i < 0) break;
    h = h.slice(i + 1);
  }
  // entidades: "google.*" para www.google.com.mx
  const parts = host.split(".");
  const suffixLen = parts.length > 2 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 2 : 1;
  const noSuffix = parts.slice(0, Math.max(parts.length - suffixLen, 0));
  const entities = [];
  for (let i = 0; i < noSuffix.length; i++) entities.push(noSuffix.slice(i).join(".") + ".*");

  const sources = [
    ["__mbs$1", typeof __mbsG !== "undefined" ? __mbsG : null, true],
    ["__mbs$2", typeof __mbsS !== "undefined" ? __mbsS : null, false]
  ];
  const state = window.__mbsDelivered || (window.__mbsDelivered = {});

  for (const [key, data, generic] of sources) {
    if (!data || state[key]) continue;
    state[key] = true;
    if (data.off.some(d => host === d || host.endsWith("." + d))) continue;

    const exc = new Set();
    for (const k of candidates.concat(entities, [""])) for (const sig of data.exc[k] || []) exc.add(sig);
    if (exc.has("*")) continue;

    const calls = [];
    const seen = new Set();
    const add = list => {
      for (const call of list || []) {
        const sig = call.join("\u0001");
        if (exc.has(sig) || seen.has(sig)) continue;
        seen.add(sig);
        calls.push(call);
      }
    };
    if (generic) {
      add(data.generic);
      for (const k of entities) add(data.entity[k]);
    } else {
      for (const k of candidates) add(data.specific[k]);
    }
    if (calls.length) window.wrappedJSObject[key] = cloneInto(calls, window);
  }
})();
