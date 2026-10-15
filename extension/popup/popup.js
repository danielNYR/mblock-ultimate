"use strict";

(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const $ = id => document.getElementById(id);

  async function render() {
    const s = await browser.runtime.sendMessage({ type: "popupState", tabId: tab.id });
    $("host").textContent = s.host || "(página interna)";
    $("siteToggle").checked = s.siteEnabled;
    $("siteToggle").disabled = !s.host || !s.enabled;
    $("tabCount").textContent = s.tabCount.toLocaleString();
    $("total").textContent = s.total.toLocaleString();
    $("trustedNote").hidden = !s.trusted;
    $("phantom").hidden = !s.phantom;
    $("phantomReason").textContent = s.phantom;
    $("cookies").textContent = s.cookieCount ? `Cookies recibidas en esta página: ${s.cookieCount}` : "";
    $("addTrusted").disabled = !s.host || s.trusted;
    return s;
  }

  const s = await render();

  $("siteToggle").addEventListener("change", async () => {
    await browser.runtime.sendMessage({ type: "toggleSite", host: s.host });
    browser.tabs.reload(tab.id);
    window.close();
  });
  $("addTrusted").addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "addTrusted", host: s.host });
    render();
  });
  $("options").addEventListener("click", () => { browser.runtime.openOptionsPage(); window.close(); });
})();
