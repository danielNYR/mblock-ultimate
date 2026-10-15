"use strict";

const $ = id => document.getElementById(id);
const LISTS = ["allowlist", "disabledSites"];
const URL_LISTS = ["customListUrls"];
const RAW_LISTS = ["customBlock"];

function flash(msg) {
  $("status").textContent = msg;
  setTimeout(() => { $("status").textContent = ""; }, 2500);
}

function parseList(text) {
  return [...new Set(text.split(/[\s,]+/).map(normalizeEntry).filter(Boolean))];
}

function fmtDate(t) {
  return t ? new Date(t).toLocaleString() : "nunca";
}

function countText(st) {
  if (!st) return "";
  const ignored = st.ignored ? ` (${st.ignored} no soportados)` : "";
  return `${st.network + st.cosmetic + (st.scriptlets || 0)} filtros${ignored} · `;
}

function listInfo(st, m) {
  const error = m.error ? ` · error: ${m.error}` : "";
  return `${countText(st)}actualizada: ${fmtDate(m.updated)}${error}`;
}

function ownFiltersInfo(own) {
  if (!own) return "";
  const ignored = own.ignored ? `, ${own.ignored} no soportados` : "";
  return `Mis filtros: ${own.network + own.cosmetic + (own.scriptlets || 0)} activos${ignored}`;
}

function renderCatalog(s, meta, stats) {
  const root = $("catalog");
  root.textContent = "";
  let group = "";
  const entries = LIST_CATALOG.map(l => Object.assign({ custom: false }, l))
    .concat(s.customListUrls.map(url => ({ id: "custom:" + url, name: url, group: "Personalizadas", custom: true })));
  for (const l of entries) {
    if (l.group !== group) {
      group = l.group;
      const g = document.createElement("div");
      g.className = "group";
      g.textContent = group;
      root.appendChild(g);
    }
    const row = document.createElement("label");
    row.className = "list";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = l.custom || (s.lists[l.id] !== undefined ? s.lists[l.id] : l.on);
    cb.disabled = l.custom;
    cb.addEventListener("change", () => {
      browser.storage.local.set({ lists: Object.assign({}, s.lists, { [l.id]: cb.checked }) });
      s.lists[l.id] = cb.checked;
    });
    const name = document.createElement("span");
    name.textContent = l.name;
    const info = document.createElement("span");
    info.className = "muted";
    info.textContent = listInfo(stats[l.id], meta[l.id] || {});
    row.append(cb, name, info);
    root.appendChild(row);
  }
}

async function refreshCatalog() {
  const s = Object.assign({}, DEFAULT_SETTINGS, await browser.storage.local.get(["lists", "customListUrls"]));
  const { listMeta, listStats } = await browser.storage.local.get(["listMeta", "listStats"]);
  renderCatalog(s, listMeta || {}, listStats || {});
  $("listsInfo").textContent = ownFiltersInfo((listStats || {}).user);
}

async function load() {
  const s = Object.assign({}, DEFAULT_SETTINGS, await browser.storage.local.get(SETTING_KEYS.concat(["totalBlocked"])));
  await refreshCatalog();
  for (const k of RAW_LISTS) $(k).value = (s[k] || []).join("\n");
  for (const el of document.querySelectorAll("input[data-key]")) {
    if (el.type === "checkbox") el.checked = !!s[el.dataset.key];
    else el.value = s[el.dataset.key];
  }
  for (const k of LISTS.concat(URL_LISTS)) $(k).value = (s[k] || []).join("\n");
  $("total").textContent = s.totalBlocked || 0;
}

for (const el of document.querySelectorAll("input[data-key]")) {
  el.addEventListener("change", () => {
    const value = el.type === "checkbox" ? el.checked : Math.max(1, parseInt(el.value, 10) || DEFAULT_SETTINGS[el.dataset.key]);
    browser.storage.local.set({ [el.dataset.key]: value });
  });
}

$("save").addEventListener("click", async () => {
  const data = {};
  for (const k of LISTS) data[k] = parseList($(k).value);
  for (const k of URL_LISTS) data[k] = [...new Set($(k).value.split(/\s+/).filter(u => /^https:\/\//.test(u)))];
  for (const k of RAW_LISTS) data[k] = $(k).value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  await browser.storage.local.set(data);
  await load();
  flash("Guardado");
});

$("resetStats").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "resetStats" });
  load();
});

$("updateLists").addEventListener("click", async () => {
  $("listsInfo").textContent = "Descargando…";
  try {
    const n = await browser.runtime.sendMessage({ type: "updateLists" });
    flash(`${n} listas actualizadas`);
  } catch (e) {
    flash("Error al actualizar: " + e.message);
  }
  load();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.listStats || changes.listMeta)) refreshCatalog();
});

load();
