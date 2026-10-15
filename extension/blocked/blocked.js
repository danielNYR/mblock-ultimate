"use strict";

const params = new URLSearchParams(location.search);
const url = params.get("url") || "";
document.getElementById("url").textContent = url;
document.getElementById("rule").textContent = params.get("rule") || "";
document.getElementById("list").textContent = params.get("list") || "";

document.getElementById("back").addEventListener("click", () => {
  if (history.length > 1) history.back();
  else browser.tabs.getCurrent().then(t => browser.tabs.remove(t.id));
});

document.getElementById("proceed").addEventListener("click", async () => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return; // URL inválida: no hay a dónde continuar
  }
  if (!/^https?:$/.test(parsed.protocol)) return;
  await browser.runtime.sendMessage({ type: "strictBypass", host: parsed.hostname });
  location.replace(url);
});
