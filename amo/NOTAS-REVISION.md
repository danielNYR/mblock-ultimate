# Notes for AMO reviewers

MBlock Ultimate is an open-source content blocker (GPL-3.0) by Moldhea. Source: https://github.com/danielNYR/mblock-ultimate

**No build step:** the submitted package is exactly the `extension/` folder of the repository. The code is not minified or bundled, and there are no third-party libraries.

## Remote content is data, never code

- **Filter lists.** The extension downloads filter lists in EasyList / uBlock Origin / AdGuard syntax: EasyList, EasyPrivacy, uBlock filters, URLhaus, Phishing and the project's own community list. It parses them as text in `lib/filters.js`. Nothing from a list is evaluated as code.
- **Scriptlets.** Scriptlets (`##+js(...)` rules) are implemented locally in `scriptlets/lib.js`. A list can only select one of those local functions by name and pass string arguments.
- **How scriptlets are delivered.**
  - `scriptlets/lib.js` is registered in the page context (`scripting.registerContentScripts`, `world: "MAIN"`).
  - The per-site arguments are delivered by `content/scriptlet-loader.js`. It is registered together with a code string of the form `var __mbsS = <JSON data>;` through `contentScripts.register`.
  - That string is generated only by `background.js`, with `JSON.stringify`, from the parsed filters. It contains data only.
- **Scriptlets that rewrite page text** (`replace-node-text`) are only accepted from the built-in rules, the user's own filters, or uBlock Origin's own lists.
- **CSS.** Cosmetic filters are injected with `tabs.insertCSS` (`cssOrigin: "user"`). Selectors containing `{`, `}` or `/*` are rejected, to prevent CSS injection.

## Permissions

| Permission | Why |
|---|---|
| `<all_urls>`, `webRequest`, `webRequestBlocking` | Block ad, tracker, malware and phishing requests on any site. Stop unwanted top-level redirects and pop-ups. Block public sites from reaching `localhost` or the local network. |
| `webRequest.filterResponseData` (part of `webRequest`) | YouTube only: rename the ad keys (`adPlacements`, `playerAds`, `adSlots`) in the player JSON, so the player does not schedule ads. |
| `webNavigation`, `tabs` | Know the top-level site of each tab, close pop-up tabs opened by pages, insert cosmetic CSS, and show the per-tab counter. |
| `scripting` | Register the scriptlet library in the page context (`world: "MAIN"`). |
| `cookies`, `browsingData` | "Phantom session": when the user leaves a site that showed a cookie banner or set excessive cookies, delete that site's cookies (including partitioned ones) and its `localStorage`. Sites in the user's allowlist are never wiped. |
| `storage`, `unlimitedStorage` | Settings and downloaded filter lists (about 10 MB). |
| `alarms` | Periodic filter-list updates, which respect each list's `! Expires` header. |

## Headers

- **Sec-GPC:** the extension adds `Sec-GPC: 1` (Global Privacy Control).
- **Phantom sessions:** while a tab is in a phantom session, the extension removes `Cookie` / `Set-Cookie` headers on third-party requests.
- **Security headers:** it never modifies CSP or any other security header.

## Data collection

None. The manifest declares `data_collection_permissions: { required: ["none"] }`. See PRIVACIDAD.md: no telemetry, analytics or identifiers. The only outgoing requests are the filter-list downloads, which are made without credentials.

## How to test

1. Open `https://www.youtube.com/`. Video ads are removed or skipped; banner slots are hidden.
2. Open any news site. The toolbar badge counts blocked requests. The cookie banner is rejected automatically, and the popup shows "Sesión fantasma".
3. In Options → "Mis filtros", add `||example.com^` and save. Then open `https://example.com/`: the local warning page (`blocked/blocked.html`) shows the matching filter, with "Volver" and "Continuar de todas formas". Real malware and phishing domains from the URLhaus and Phishing lists get the same page.
4. Options: filter-list catalog, "Mis filtros" (custom filters), allowlist ("Dominios seguros").

The UI is in Spanish. The project's automated tests (78 tests, ≥80 % coverage) run with `npm ci && npm run coverage`.
