// Banners de cookies: primero intenta "Rechazar"; si el sitio solo deja
// "Aceptar", acepta en sesión fantasma (el background borra todo al salir);
// si no hay botones reconocibles, oculta el banner y desbloquea el scroll.
// Las reglas por CMP están inspiradas en Consent-O-Matic y DuckDuckGo autoconsent.
"use strict";

(() => {
  const CMPS = [
    { name: "OneTrust", banner: "#onetrust-banner-sdk", reject: "#onetrust-reject-all-handler, .ot-pc-refuse-all-handler", accept: "#onetrust-accept-btn-handler" },
    { name: "Cookiebot", banner: "#CybotCookiebotDialog", reject: "#CybotCookiebotDialogBodyButtonDecline, #CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll", accept: "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept" },
    { name: "Didomi", banner: "#didomi-host, #didomi-notice", reject: "#didomi-notice-disagree-button, .didomi-continue-without-agreeing", accept: "#didomi-notice-agree-button" },
    { name: "Quantcast", banner: ".qc-cmp2-container", reject: ".qc-cmp2-summary-buttons button[mode=\"secondary\"]", accept: ".qc-cmp2-summary-buttons button[mode=\"primary\"]" },
    { name: "CookieYes", banner: ".cky-consent-container", reject: ".cky-btn-reject", accept: ".cky-btn-accept" },
    { name: "Complianz", banner: ".cmplz-cookiebanner", reject: ".cmplz-deny", accept: ".cmplz-accept" },
    { name: "Osano", banner: ".osano-cm-window", reject: ".osano-cm-denyAll, .osano-cm-deny", accept: ".osano-cm-accept-all, .osano-cm-accept" },
    { name: "iubenda", banner: "#iubenda-cs-banner", reject: ".iubenda-cs-reject-btn", accept: ".iubenda-cs-accept-btn" },
    { name: "TrustArc", banner: "#truste-consent-track", reject: "#truste-consent-required", accept: "#truste-consent-button" },
    { name: "Klaro", banner: ".klaro .cookie-notice, .klaro .cookie-modal", reject: ".cn-decline", accept: ".cm-btn-accept-all, .cm-btn-success" },
    { name: "Borlabs", banner: "#BorlabsCookieBox", reject: "#BorlabsCookieBox a[data-cookie-refuse], #BorlabsCookieBox ._brlbs-refuse-btn a", accept: "#BorlabsCookieBox a[data-cookie-accept]" },
    { name: "Cookie Notice", banner: "#cookie-notice", reject: "#cn-refuse-cookie", accept: "#cn-accept-cookie" }
  ];

  // Textos de botón reconocidos (es, en, fr, de); cada patrón cubre una familia de frases.
  const REJECT_PATTERNS = [
    /^rechazar(?: todo| todas| todas las cookies)?$/i,
    /^(?:rechazo|no acepto|denegar|continuar sin aceptar)$/i,
    /^solo (?:las )?(?:cookies )?(?:necesarias|esenciales|t[eé]cnicas)$/i,
    /^usar solo (?:las )?necesarias$/i,
    /^(?:reject|decline|deny)(?: all)?(?: cookies)?$/i,
    /^(?:only (?:necessary|essential)(?: cookies)?|necessary only)$/i,
    /^(?:refuser(?: tout)?|tout refuser|continuer sans accepter)$/i,
    /^(?:alle )?ablehnen$|^nur notwendige$/i
  ];
  const ACCEPT_PATTERNS = [
    /^aceptar(?: todo| todas| todas las cookies| y cerrar| y continuar)?$/i,
    /^(?:acepto|de acuerdo|entendido)$/i,
    /^permitir(?: todas| todo)?$/i,
    /^(?:accept|allow)(?: all)?(?: cookies)?$/i,
    /^(?:i )?(?:agree|accept)$|^got it$|^ok(?:ay)?$/i,
    /^(?:accepter(?: tout)?|tout accepter)$/i,
    /^(?:alle )?akzeptieren$/i
  ];
  const REJECT_RE = { test: text => REJECT_PATTERNS.some(re => re.test(text)) };
  const ACCEPT_RE = { test: text => ACCEPT_PATTERNS.some(re => re.test(text)) };
  const COOKIE_TEXT = /cookie|consent/i;

  let state = null;
  let done = false;
  const startedAt = Date.now();

  const label = el => (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "")
    .trim().replace(/\s+/g, " ").replace(/[.!]$/, "");

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05;
  }

  function buttons(root) {
    return [...root.querySelectorAll("button, a, [role=\"button\"], input[type=\"button\"], input[type=\"submit\"]")].filter(visible);
  }

  function findGenericBanner() {
    const sel = "[id*=\"cookie\" i], [class*=\"cookie\" i], [id*=\"consent\" i], [class*=\"consent\" i], [aria-label*=\"cookie\" i], [role=\"dialog\"], [aria-modal=\"true\"]";
    const found = [...document.querySelectorAll(sel)].filter(el => {
      if (!visible(el)) return false;
      const text = el.innerText || "";
      return text.length < 4000 && COOKIE_TEXT.test(text) && buttons(el).length > 0;
    });
    // el contenedor más externo
    return found.find(el => !found.some(o => o !== el && o.contains(el))) || null;
  }

  function unlockScroll() {
    for (const el of [document.documentElement, document.body]) {
      if (el && getComputedStyle(el).overflow === "hidden") el.style.setProperty("overflow", "auto", "important");
    }
  }

  function hideBanner(banner) {
    banner.style.setProperty("display", "none", "important");
    // fondos oscuros que bloquean la página
    for (const el of document.querySelectorAll("[class*=\"overlay\" i], [class*=\"backdrop\" i], [id*=\"overlay\" i]")) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.position === "fixed" && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9 && !(el.innerText || "").trim()) {
        el.style.setProperty("display", "none", "important");
      }
    }
  }

  function finish(button, action, banner) {
    done = true;
    if (button) button.click();
    else if (banner) hideBanner(banner);
    setTimeout(unlockScroll, 500);
    browser.runtime.sendMessage({ type: "consent", action }).catch(() => {});
  }

  function decide(banner, rejectSel, acceptSel) {
    const btns = buttons(banner);
    const reject = (rejectSel && [...document.querySelectorAll(rejectSel)].find(visible)) || btns.find(b => REJECT_RE.test(label(b)));
    if (reject) return finish(reject, "reject");
    if (state.phantomAccept) {
      const accept = (acceptSel && [...document.querySelectorAll(acceptSel)].find(visible)) || btns.find(b => ACCEPT_RE.test(label(b)));
      if (accept) return finish(accept, "accept");
    }
    finish(null, "hide", banner);
  }

  function run() {
    if (done || !state || !state.active || !state.consentAuto || state.trusted) return;
    for (const cmp of CMPS) {
      const banner = document.querySelector(cmp.banner);
      if (banner && visible(banner)) return decide(banner, cmp.reject, cmp.accept);
    }
    const banner = findGenericBanner();
    if (banner) decide(banner);
  }

  let timer = null;
  const observer = new MutationObserver(() => {
    if (done || Date.now() - startedAt > 20000) { observer.disconnect(); return; }
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });

  browser.runtime.sendMessage({ type: "getState" }).then(s => {
    state = s;
    if (!s || !s.active || !s.consentAuto || s.trusted) return;
    run();
    if (!done) observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  }).catch(() => {});
})();
