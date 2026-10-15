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

  // "a.b.example.com" -> ["a.b.example.com", "b.example.com", "example.com", "com"]
  function hostCandidates(h) {
    const out = [];
    while (h) {
      out.push(h);
      const i = h.indexOf(".");
      if (i < 0) break;
      h = h.slice(i + 1);
    }
    return out;
  }

  // entidades: "google.*" para www.google.com.mx
  function entityKeys(h) {
    const parts = h.split(".");
    const twoLevel = parts.length > 2 && parts.at(-1).length === 2 && SECOND_LEVEL.has(parts.at(-2));
    const noSuffix = parts.slice(0, Math.max(parts.length - (twoLevel ? 2 : 1), 0));
    return noSuffix.map((_, i) => noSuffix.slice(i).join(".") + ".*");
  }

  function exceptionsFor(data, keys) {
    const exc = new Set();
    for (const k of keys.concat([""])) for (const sig of data.exc[k] || []) exc.add(sig);
    return exc;
  }

  function collectCalls(lists, exc) {
    const calls = [];
    const seen = new Set();
    for (const list of lists) {
      for (const call of list || []) {
        const sig = call.join("\u0001");
        if (exc.has(sig) || seen.has(sig)) continue;
        seen.add(sig);
        calls.push(call);
      }
    }
    return calls;
  }

  const candidates = hostCandidates(host);
  const entities = entityKeys(host);
  const state = window.__mbsDelivered || (window.__mbsDelivered = {});

  function deliver(key, data, generic) {
    if (!data || state[key]) return;
    state[key] = true;
    if (data.off.some(d => host === d || host.endsWith("." + d))) return;
    const exc = exceptionsFor(data, candidates.concat(entities));
    if (exc.has("*")) return;
    const lists = generic
      ? [data.generic].concat(entities.map(k => data.entity[k]))
      : candidates.map(k => data.specific[k]);
    const calls = collectCalls(lists, exc);
    if (calls.length) window.wrappedJSObject[key] = cloneInto(calls, window);
  }

  deliver("__mbs$1", typeof __mbsG === "undefined" ? null : __mbsG, true);
  deliver("__mbs$2", typeof __mbsS === "undefined" ? null : __mbsS, false);
})();
