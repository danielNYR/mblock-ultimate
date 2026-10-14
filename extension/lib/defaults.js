"use strict";

const DEFAULT_SETTINGS = {
  enabled: true,          // interruptor global
  adBlock: true,          // bloqueo de red + cosmético
  scriptlets: true,       // scriptlets de las listas (##+js), p. ej. contra avisos anti-bloqueador
  redirectGuard: true,    // guardia de popups / redirecciones
  youtube: true,          // manejo específico de YouTube
  facebook: true,         // ocultar posts patrocinados de Facebook
  localNetGuard: true,    // impedir que sitios públicos accedan a localhost / red local
  blockNotifications: true, // negar solicitudes de notificaciones push en sitios no seguros
  lists: {},              // id de LIST_CATALOG -> activada (lo no indicado usa el valor por defecto)
  customListUrls: [],     // listas extra por URL (sintaxis ABP/uBO, hosts o dominio por línea)
  strictBlocking: true,   // página de advertencia al abrir un dominio bloqueado (malware, phishing…)
  consentAuto: true,      // rechazar banners de cookies automáticamente
  phantomAccept: true,    // si solo se puede "Aceptar", aceptar en sesión fantasma
  phantomCookies: true,   // sesión fantasma: borrar cookies del sitio al cerrar la pestaña
  cookieLimit: 20,        // cookies por página a partir de las cuales se considera "excesivo"
  gpc: true,              // enviar Global Privacy Control (Sec-GPC: 1)
  disabledSites: [],      // sitios donde la extensión no actúa
  customBlock: [],        // "Mis filtros": reglas propias en sintaxis ABP/uBO (o dominios)
  // Destinos permitidos para popups / redirecciones. Un sitio de esta lista
  // también se considera de confianza como origen (no se vigila).
  allowlist: [
    "google.com", "google.com.mx", "gstatic.com", "youtube.com", "youtu.be",
    "facebook.com", "fb.com", "messenger.com", "instagram.com", "whatsapp.com",
    "x.com", "twitter.com", "linkedin.com", "reddit.com", "github.com",
    "microsoft.com", "live.com", "microsoftonline.com", "office.com", "bing.com",
    "apple.com", "icloud.com", "paypal.com", "mercadopago.com.mx", "mercadolibre.com.mx",
    "amazon.com", "amazon.com.mx", "wikipedia.org", "netflix.com", "spotify.com",
    "twitch.tv", "duckduckgo.com", "mozilla.org", "firefox.com", "claude.ai", "anthropic.com"
  ]
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
