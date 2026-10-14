// Facebook: oculta publicaciones patrocinadas del feed y la sección
// "Patrocinado" de la columna derecha. Facebook ofusca la etiqueta, así que
// se combinan varias señales.
"use strict";

(() => {
  const LABEL = /^(sponsored|patrocinado|patrocinada|publicidad|sponsoris[ée]|gesponsert|sponsorizzato)$/i;
  let enabled = true;

  browser.runtime.sendMessage({ type: "getState" })
    .then(s => { enabled = !!s && s.active && s.facebook; if (enabled) scan(); })
    .catch(() => {});

  const clean = t => (t || "").replace(/[\s​-‍﻿]+/g, "");

  function svgUseText(root) {
    for (const use of root.querySelectorAll("svg use")) {
      const ref = use.getAttribute("href") || use.getAttribute("xlink:href");
      if (!ref || ref[0] !== "#") continue;
      const target = document.getElementById(ref.slice(1));
      if (target && LABEL.test(clean(target.textContent))) return true;
    }
    return false;
  }

  function isSponsored(post) {
    if (post.querySelector("a[href*=\"/ads/about\"]")) return true;
    for (const el of post.querySelectorAll("[aria-label]")) {
      if (LABEL.test(clean(el.getAttribute("aria-label")))) return true;
    }
    const links = post.querySelectorAll("a[role=\"link\"], span[dir=\"auto\"] > span, [aria-labelledby]");
    for (let i = 0; i < links.length && i < 40; i++) {
      if (LABEL.test(clean(links[i].innerText))) return true;
    }
    return svgUseText(post);
  }

  function hide(el) {
    if (el.dataset.abgHidden) return;
    el.dataset.abgHidden = "1";
    el.style.setProperty("display", "none", "important");
    browser.runtime.sendMessage({ type: "blocked" }).catch(() => {});
  }

  function scan() {
    if (!enabled) return;
    const posts = document.querySelectorAll("[role=\"feed\"] > div, div[data-pagelet^=\"FeedUnit\"], [role=\"article\"][aria-posinset]");
    for (const p of posts) {
      if (!p.dataset.abgChecked || p.dataset.abgChecked < 3) {
        p.dataset.abgChecked = String((+p.dataset.abgChecked || 0) + 1); // reintenta: FB carga el contenido en partes
        if (isSponsored(p)) hide(p);
      }
    }
    const rail = document.querySelector("[data-pagelet=\"RightRail\"]");
    if (rail) {
      for (const h of rail.querySelectorAll("h3, span")) {
        if (LABEL.test(clean(h.innerText))) {
          const block = h.closest("[data-pagelet=\"RightRail\"] > div > div") || h.parentElement;
          if (block) hide(block);
        }
      }
    }
  }

  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; scan(); }, 400);
  }).observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
