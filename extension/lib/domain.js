// Utilidades de dominios compartidas por background y content scripts.
"use strict";

const SECOND_LEVEL = new Set(["com", "net", "org", "gov", "gob", "edu", "ac", "co", "or", "ne", "go", "mil", "nom"]);

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.hostname.toLowerCase();
  } catch {
    // URL inválida o relativa: no tiene host
    return "";
  }
}

// "Sitio" aproximado (dominio registrable): www.ejemplo.com.mx -> ejemplo.com.mx
function siteOf(host) {
  if (!host) return "";
  if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const n = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return parts.slice(-n).join(".");
}

function sameSite(a, b) {
  return !!a && !!b && siteOf(a) === siteOf(b);
}

function normalizeEntry(entry) {
  let s = String(entry || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "");
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  return s.replace(/^\*\./, "").replace(/^\./, "");
}

// true si host es igual a alguna entrada de la lista o subdominio de ella.
function hostInList(host, list) {
  if (!host || !list) return false;
  for (const raw of list) {
    const e = normalizeEntry(raw);
    if (e && (host === e || host.endsWith("." + e))) return true;
  }
  return false;
}

// true para localhost, IPs privadas/link-local y nombres .local/.lan/.home.arpa
function isPrivateHost(host) {
  if (!host) return false;
  const h = host.replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || /\.(local|lan|internal|home\.arpa)$/.test(h)) return true;
  if (h === "::1" || /^f[cd][0-9a-f]{2}:/i.test(h) || /^fe80:/i.test(h)) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

// Igual que hostInList pero con Set (O(niveles del host)).
function hostInSet(host, set) {
  let h = host;
  while (h) {
    if (set.has(h)) return true;
    const i = h.indexOf(".");
    if (i < 0) return false;
    h = h.slice(i + 1);
  }
  return false;
}

// Extrae dominios de una lista: un dominio por línea, formato hosts
// ("0.0.0.0 dominio") o reglas de dominio ABP sin opciones ("||dominio^").
function parseDomainList(text) {
  const out = new Set();
  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim().toLowerCase();
    if (!line || line[0] === "#" || line[0] === "!") continue;
    let m = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s#]+)/.exec(line) || /^\|\|([a-z0-9.-]+)\^(?:\$(?:third-party|3p))?$/.exec(line);
    const d = m ? m[1] : line;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d) && d !== "localhost") out.add(d);
  }
  return [...out];
}

if (typeof module !== "undefined") {
  module.exports = { hostOf, siteOf, sameSite, normalizeEntry, hostInList, hostInSet, isPrivateHost, parseDomainList };
}
