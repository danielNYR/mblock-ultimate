// Guardia en página: window.open, overlays invisibles, meta refresh,
// notificaciones push y aviso al background de los clics reales del usuario.
"use strict";

(() => {
  let state = null; // null = aún cargando (se asume protección activa)
  const pageWin = window.wrappedJSObject;

  browser.runtime.sendMessage({ type: "getState" })
    .then(s => { state = s; })
    .catch(() => {});

  const guardOn = () => !state || (state.active && state.redirectGuard && !state.trusted);
  const allowlist = () => (state && state.allowlist) || DEFAULT_SETTINGS.allowlist;
  const report = () => browser.runtime.sendMessage({ type: "blocked" }).catch(() => {});

  function destinationAllowed(rawUrl) {
    let url;
    try { url = new URL(rawUrl, location.href); } catch (e) { return true; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return true;
    const host = url.hostname.toLowerCase();
    const here = location.hostname || (state && state.topHost) || "";
    return sameSite(host, here) || (state && sameSite(host, state.topHost)) || hostInList(host, allowlist());
  }

  // ---- window.open ----
  const origOpen = pageWin.open;
  exportFunction(function (url, target, features) {
    if (guardOn() && url && String(url) !== "about:blank" && !destinationAllowed(String(url))) {
      report();
      return null;
    }
    return origOpen.call(pageWin, url, target, features);
  }, pageWin, { defineAs: "open" });

  // ---- Global Privacy Control (la cabecera Sec-GPC la añade el background) ----
  try {
    Reflect.defineProperty(pageWin.navigator, "globalPrivacyControl", {
      get: exportFunction(() => !state || !!(state.active && state.gpc), pageWin),
      configurable: true
    });
  } catch (e) { /* navigator no redefinible */ }

  // ---- Notificaciones push (spam típico de sitios de streaming) ----
  function notificationsBlocked() {
    return !state ? true : state.active && state.blockNotifications && !state.trusted;
  }
  try {
    const N = pageWin.Notification;
    if (N) {
      const origRequest = N.requestPermission;
      exportFunction(function (cb) {
        if (notificationsBlocked()) {
          report();
          if (typeof cb === "function") { try { cb("denied"); } catch (e) { /* callback de la página */ } }
          return pageWin.Promise.resolve("denied");
        }
        return origRequest.apply(N, arguments);
      }, N, { defineAs: "requestPermission" });
    }
    const PM = pageWin.PushManager && pageWin.PushManager.prototype;
    if (PM) {
      const origSubscribe = PM.subscribe;
      exportFunction(function () {
        if (notificationsBlocked()) {
          report();
          return pageWin.Promise.reject(new pageWin.DOMException("Bloqueado por MBlock Ultimate", "NotAllowedError"));
        }
        return origSubscribe.apply(this, arguments);
      }, PM, { defineAs: "subscribe" });
    }
  } catch (e) { /* API no disponible en este contexto */ }

  // ---- Clics: overlays invisibles y enlaces legítimos ----
  function effectiveOpacity(el) {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      o *= parseFloat(getComputedStyle(n).opacity || "1");
      if (o < 0.1) break;
    }
    return o;
  }

  function hasVisibleContent(a) {
    if (a.innerText && a.innerText.trim()) return true;
    if (a.querySelector("img, svg, video, picture, canvas")) return true;
    return getComputedStyle(a).backgroundImage !== "none";
  }

  function coversMedia(a, x, y) {
    return document.elementsFromPoint(x, y).some(el => el !== a && !a.contains(el) && /^(VIDEO|IFRAME|OBJECT|EMBED|CANVAS)$/.test(el.tagName));
  }

  function isSuspicious(a, e) {
    if (effectiveOpacity(a) < 0.1) return true;
    if (hasVisibleContent(a)) return false;
    const r = a.getBoundingClientRect();
    const large = r.width * r.height > 0.25 * innerWidth * innerHeight;
    return large || coversMedia(a, e.clientX, e.clientY);
  }

  function neutralize(el) {
    el.style.setProperty("pointer-events", "none", "important");
    el.style.setProperty("display", "none", "important");
  }

  function onUserClick(e) {
    if (!e.isTrusted || !guardOn()) return;
    const a = e.target && e.target.closest && e.target.closest("a[href], area[href]");
    if (!a) return;
    const host = hostOf(a.href);
    if (!host) return;
    if (destinationAllowed(a.href)) {
      browser.runtime.sendMessage({ type: "intent", host }).catch(() => {});
      return;
    }
    if (e.type !== "contextmenu" && isSuspicious(a, e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      neutralize(a);
      report();
      return;
    }
    browser.runtime.sendMessage({ type: "intent", host }).catch(() => {});
  }

  for (const t of ["click", "auxclick", "contextmenu"]) window.addEventListener(t, onUserClick, true);

  window.addEventListener("submit", e => {
    if (!e.isTrusted || !guardOn()) return;
    const host = hostOf(e.target.action || location.href);
    if (host) browser.runtime.sendMessage({ type: "intent", host }).catch(() => {});
  }, true);

  // ---- meta refresh hacia otros dominios ----
  function checkMeta(meta) {
    if (!guardOn() || !/refresh/i.test(meta.httpEquiv || "")) return;
    const m = /url\s*=\s*['"]?([^'";]+)/i.exec(meta.content || "");
    if (m && !destinationAllowed(m[1].trim())) {
      meta.remove();
      report();
    }
  }
  new MutationObserver(muts => {
    for (const mu of muts) for (const n of mu.addedNodes) {
      if (n.nodeName === "META") checkMeta(n);
    }
  }).observe(document, { childList: true, subtree: true });
})();
