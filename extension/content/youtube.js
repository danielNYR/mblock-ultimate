// YouTube: si a pesar del filtrado de red aparece un anuncio en el reproductor,
// se reacciona en el mismo instante en que el reproductor cambia a modo anuncio
// (MutationObserver sobre su clase): se oculta (CSS integrado), se silencia,
// se acelera/adelanta y se pulsa "Omitir". Al terminar se restaura todo.
"use strict";

(() => {
  let enabled = true;
  let inAd = false;
  let saved = null; // {muted, rate} antes del anuncio
  let player = null;
  let playerObserver = null;

  const SKIP = [
    ".ytp-ad-skip-button", ".ytp-ad-skip-button-modern", ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-slot button", ".ytp-ad-skip-button-container button", "button[id^=\"skip-button\"]"
  ].join(",");
  const MAX_AD_SECONDS = 180; // con streams "cosidos" (SABR) no adelantamos al final de un video largo

  browser.runtime.sendMessage({ type: "getState" })
    .then(s => { enabled = !!s && s.active && s.youtube; if (!enabled) restore(); })
    .catch(() => {});

  function isAd(p) {
    return p.classList.contains("ad-showing") || p.classList.contains("ad-interrupting");
  }

  function restore() {
    const video = player && player.querySelector("video");
    if (video && saved) {
      video.muted = saved.muted;
      video.playbackRate = saved.rate;
    }
    saved = null;
    inAd = false;
  }

  // Adelanta el anuncio al final; si la duración no es fiable (streams cosidos), lo acelera.
  function fastForward(video) {
    const short = Number.isFinite(video.duration) && video.duration > 0 && video.duration <= MAX_AD_SECONDS;
    if (!short) {
      video.playbackRate = 16;
    } else if (video.currentTime < video.duration - 0.2) {
      video.currentTime = video.duration - 0.1;
    }
  }

  function skipAd(video) {
    if (!inAd) {
      inAd = true;
      saved = { muted: video.muted, rate: video.playbackRate };
      browser.runtime.sendMessage({ type: "blocked" }).catch(() => {});
    }
    video.muted = true;
    fastForward(video);
    if (video.paused) video.play().catch(() => {});
    for (const b of document.querySelectorAll(SKIP)) b.click();
  }

  function handle() {
    if (!enabled || !player) return;
    const video = player.querySelector("video");
    if (isAd(player) && video) skipAd(video);
    else if (inAd) restore();
    for (const c of document.querySelectorAll(".ytp-ad-overlay-close-button")) c.click();
  }

  // El reproductor se crea y se reemplaza al navegar dentro de YouTube.
  function attach() {
    const p = document.querySelector("#movie_player, .html5-video-player");
    if (p === player) return;
    player = p;
    if (playerObserver) playerObserver.disconnect();
    if (!p) return;
    playerObserver = new MutationObserver(handle);
    playerObserver.observe(p, { attributes: true, attributeFilter: ["class"] });
    handle();
  }

  // Red de seguridad: el botón "Omitir" y la duración aparecen después de la clase.
  setInterval(() => { attach(); if (inAd) handle(); }, 200);
})();
