// Filtros cosméticos genéricos "perezosos" (como uBlock Origin): se envían al
// background las clases e ids que aparecen en la página y este inyecta solo
// los selectores que podrían aplicar, en lugar de miles de reglas por página.
// El CSS específico del sitio se inyecta al pedir el estado (css: true).
"use strict";

(() => {
  const seen = new Set();
  let pending = [];
  let timer = null;

  function add(token) {
    if (!seen.has(token)) { seen.add(token); pending.push(token); }
  }

  function collect(el) {
    if (el.nodeType !== 1) return;
    if (el.id) add("i:" + el.id);
    for (const c of el.classList) add("c:" + c);
  }

  function scan(root) {
    collect(root);
    if (root.querySelectorAll) for (const el of root.querySelectorAll("[id],[class]")) collect(el);
    schedule();
  }

  function flush() {
    timer = null;
    if (!pending.length) return;
    const tokens = pending;
    pending = [];
    browser.runtime.sendMessage({ type: "cosmeticTokens", tokens }).catch(() => {});
  }

  function schedule() {
    if (!timer && pending.length) timer = setTimeout(flush, 100);
  }

  browser.runtime.sendMessage({ type: "getState", css: true }).then(s => {
    if (!s || !s.active || !s.adBlock || s.elemhide || s.generichide) return;
    const start = () => {
      scan(document.documentElement);
      new MutationObserver(muts => {
        for (const m of muts) {
          if (m.type === "attributes") collect(m.target);
          else for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
        }
        schedule();
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["id", "class"] });
    };
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }).catch(() => {});
})();
