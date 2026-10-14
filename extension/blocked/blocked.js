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
  let host = "";
  try { host = new URL(url).hostname; } catch (e) { return; }
  if (!/^https?:$/.test(new URL(url).protocol)) return;
  await browser.runtime.sendMessage({ type: "strictBypass", host });
  location.replace(url);
});
