// Filtros integrados (siempre activos) y catálogo de listas suscribibles.
"use strict";

const BUILTIN_BLOCK_DOMAINS = [
  // Google / redes grandes de anuncios
  "doubleclick.net", "googlesyndication.com", "googleadservices.com", "googletagservices.com",
  "google-analytics.com", "adservice.google.com", "pagead2.googlesyndication.com", "2mdn.net",
  "amazon-adsystem.com", "aax.amazon-adsystem.com", "adnxs.com", "criteo.com", "criteo.net",
  "pubmatic.com", "rubiconproject.com", "openx.net", "casalemedia.com", "advertising.com",
  "adform.net", "smartadserver.com", "media.net", "yieldmo.com", "bidswitch.net",
  "contextweb.com", "sharethrough.com", "teads.tv", "33across.com", "indexww.com",
  "lijit.com", "sovrn.com", "yieldlab.net", "adition.com", "smaato.net", "inmobi.com",
  "adcolony.com", "vungle.com", "chartboost.com", "mopub.com", "zedo.com", "serving-sys.com",
  "adroll.com", "moatads.com", "adsafeprotected.com", "doubleverify.com", "scorecardresearch.com",
  "quantserve.com", "quantcount.com", "taboola.com", "outbrain.com", "outbrainimg.com",
  "revcontent.com", "mgid.com", "adskeeper.com", "adskeeper.co.uk", "bidvertiser.com",
  "yieldlove.com", "adsrvr.org", "demdex.net", "everesttech.net", "rlcdn.com", "bluekai.com",
  "krxd.net", "exelator.com", "agkn.com", "mathtag.com", "turn.com", "tapad.com",
  "spotxchange.com", "spotx.tv", "springserve.com", "lkqd.net", "imasdk.googleapis.com",
  "adsymptotic.com", "adhigh.net", "adzerk.net", "carbonads.net", "buysellads.com",
  "hotjar.com", "mouseflow.com", "crazyegg.com", "clarity.ms", "ads-twitter.com",
  "ads.linkedin.com", "analytics.tiktok.com", "ads.yahoo.com", "gemini.yahoo.com",
  // Redes de popunder / adware típicas de sitios de streaming no oficiales
  "popads.net", "popcash.net", "propellerads.com", "propellerclick.com", "onclickads.net",
  "onclkds.com", "onclickmax.com", "adsterra.com", "adsterratools.com",
  "highperformanceformat.com", "profitabledisplaynetwork.com", "effectiveratecpm.com",
  "exoclick.com", "exosrv.com", "exdynsrv.com", "juicyads.com", "hilltopads.net",
  "hilltopads.com", "clickadu.com", "adcash.com", "a-ads.com", "popmyads.com",
  "trafficjunky.net", "trafficjunky.com", "trafficstars.com", "tsyndicate.com",
  "adxpansion.com", "realsrv.com", "pushame.com", "richpush.co", "evadav.com",
  "galaksion.com", "admaven.com", "ad-maven.com", "adspyglass.com", "clickaine.com",
  "popunder.net", "popmonetizer.com", "monetag.com", "zeropark.com", "pemsrv.com",
  "go.oclasrv.com", "oclasrv.com", "adsco.re", "acint.net", "betteradsystem.com",
  "redirectvoluum.com", "voluumtrk.com", "adtrafficquality.google"
];

// Reglas de URL (útiles cuando el anuncio es "first-party", p. ej. YouTube).
const BUILTIN_NETWORK_RULES = [
  "||youtube.com/api/stats/ads", "||youtube.com/pagead/", "||youtube.com/ptracking",
  "||youtube.com/get_midroll_info", "||youtube.com/youtubei/v1/player/ad_break",
  "/pagead/js/", "/pagead/ads?", "/pagead/conversion/", "/pagead/viewthroughconversion/",
  "/pagead/adview?", "/pagead/interaction/",
  "/adserver/", "/adsserver/", "/adframe/", "/adbanner/", "/popunder/"
];


// Selectores cosméticos integrados ("generic" = todos los sitios).
const COSMETIC = {
  generic: [
    "ins.adsbygoogle", ".adsbygoogle", "[id^=\"google_ads_iframe\"]", "[id^=\"div-gpt-ad\"]",
    "div[id^=\"gpt-ad\"]", "iframe[src*=\"doubleclick.net\"]", "iframe[src*=\"googlesyndication.com\"]",
    "iframe[id^=\"google_ads_\"]", "a[href*=\"doubleclick.net/\"]", "[data-ad-slot]", "[data-ad-client]",
    "[data-google-query-id]", ".ad-banner", ".ad-slot", ".ad-container", ".ad-wrapper", ".ad-unit",
    ".adsbox", ".advertisement", ".advertising", ".banner-ad", ".sponsored-content",
    "#ad-banner", "#ad-container", ".taboola", "[id^=\"taboola-\"]", ".trc_rbox_container",
    ".OUTBRAIN", "amp-ad", "amp-embed[type=\"taboola\"]", "iframe[src*=\"exoclick\"]",
    "iframe[src*=\"juicyads\"]", "iframe[src*=\"adsterra\"]"
  ],
  "youtube.com": [
    // Mientras el reproductor está en modo anuncio, el video es invisible y se
    // muestra un aviso en negro: así no se ve el anuncio antes de saltarlo.
    ".html5-video-player.ad-showing video:style(opacity: 0 !important)",
    ".html5-video-player.ad-interrupting video:style(opacity: 0 !important)",
    ".html5-video-player.ad-showing::after:style(content: \"MBlock Ultimate · saltando anuncio…\" !important; position: absolute !important; inset: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; background: #000 !important; color: #fff !important; font: 500 15px Roboto, Arial, sans-serif !important; z-index: 59 !important; pointer-events: none !important)",
    ".html5-video-player.ad-showing .video-ads", ".html5-video-player.ad-showing .ytp-ad-player-overlay-layout",
    ".ytp-ad-player-overlay", ".ytp-ad-text", ".ytp-ad-preview-container",
    // Aviso "los bloqueadores de anuncios no están permitidos"
    "ytd-enforcement-message-view-model", "tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)",
    "#masthead-ad", "ytd-ad-slot-renderer", "ytd-in-feed-ad-layout-renderer", "ytd-banner-promo-renderer",
    "ytd-promoted-sparkles-web-renderer", "ytd-promoted-video-renderer", "ytd-display-ad-renderer",
    "ytd-compact-promoted-video-renderer", "ytd-action-companion-ad-renderer",
    "ytd-player-legacy-desktop-watch-ads-renderer", "#player-ads", ".ytp-ad-overlay-container",
    ".ytp-ad-image-overlay", ".ytp-ad-overlay-slot", "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
    "ytd-rich-section-renderer:has(ytd-statement-banner-renderer)", "ytd-statement-banner-renderer",
    "ytd-merch-shelf-renderer", "ytm-promoted-sparkles-web-renderer", "ad-slot-renderer",
    "ytm-companion-ad-renderer", "ytd-engagement-panel-section-list-renderer[target-id=\"engagement-panel-ads\"]",
    "ytd-ads-engagement-panel-content-renderer", "#panels ytd-ads-engagement-panel-content-renderer"
  ],
  "facebook.com": [
    "div[data-pagelet^=\"FeedUnit\"]:has(a[href*=\"/ads/about\"])",
    "[role=\"article\"]:has(a[href*=\"/ads/about\"])",
    "[role=\"article\"]:has(a[aria-label=\"Sponsored\"])",
    "[role=\"article\"]:has(a[aria-label=\"Patrocinado\"])",
    "[role=\"article\"]:has(a[aria-label=\"Publicidad\"])"
  ]
};

// Todo lo integrado expresado como lista de filtros para el motor.
const BUILTIN_FILTERS = [].concat(
  BUILTIN_BLOCK_DOMAINS.map(d => "||" + d + "^"),
  BUILTIN_NETWORK_RULES,
  ...Object.keys(COSMETIC).map(k => COSMETIC[k].map(sel => (k === "generic" ? "" : k) + "##" + sel))
).join("\n");

// Listas suscribibles. "on" = activada por defecto.
const LIST_CATALOG = [
  { id: "easylist", name: "EasyList", group: "Anuncios", on: true,
    url: "https://easylist.to/easylist/easylist.txt" },
  { id: "easylist-es", name: "EasyList Spanish", group: "Anuncios (regional)", on: true,
    url: "https://easylist-downloads.adblockplus.org/easylistspanish.txt" },
  { id: "adguard-es", name: "AdGuard Spanish/Portuguese", group: "Anuncios (regional)", on: false,
    url: "https://filters.adtidy.org/extension/ublock/filters/9.txt" },
  { id: "ubo-filters", name: "uBlock filters", group: "Anuncios", on: true,
    url: "https://ublockorigin.github.io/uAssets/filters/filters.txt" },
  { id: "ubo-quick", name: "uBlock filters – Quick fixes (YouTube y arreglos urgentes)", group: "Anuncios", on: true,
    url: "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt" },
  { id: "peter-lowe", name: "Peter Lowe's Ad and tracking server list", group: "Anuncios", on: true,
    url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext" },
  { id: "easyprivacy", name: "EasyPrivacy", group: "Privacidad", on: true,
    url: "https://easylist.to/easylist/easyprivacy.txt" },
  { id: "ubo-privacy", name: "uBlock filters – Privacy", group: "Privacidad", on: true,
    url: "https://ublockorigin.github.io/uAssets/filters/privacy.txt" },
  { id: "urlhaus", name: "Online Malicious URL Blocklist (URLhaus)", group: "Malware y phishing", on: true,
    url: "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter.txt" },
  { id: "phishing", name: "Phishing URL Blocklist", group: "Malware y phishing", on: true,
    url: "https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt" },
  { id: "ubo-badware", name: "uBlock filters – Badware risks", group: "Malware y phishing", on: true,
    url: "https://ublockorigin.github.io/uAssets/filters/badware.txt" },
  { id: "fanboy-annoyance", name: "Fanboy's Annoyance (popups, chats, redes sociales)", group: "Molestias", on: false,
    url: "https://secure.fanboy.co.nz/fanboy-annoyance.txt" },
  { id: "fanboy-cookie", name: "EasyList Cookie List (oculta banners)", group: "Molestias", on: false,
    url: "https://secure.fanboy.co.nz/fanboy-cookiemonster.txt" }
];
