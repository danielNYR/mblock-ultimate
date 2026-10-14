# Proyectos similares e ideas adoptadas

Revisión hecha el 14 de octubre de 2026 para decidir cómo mantener la extensión con ayuda de la comunidad.

| Proyecto | Qué hace | Idea que tomamos |
|---|---|---|
| [uBlock Origin / uAssets](https://github.com/uBlockOrigin/uAssets) | Bloqueador de referencia. Sus filtros viven en un repositorio aparte, mantenido por la comunidad mediante issues. | Separar los **filtros** (`filtros/`) del código y recibir reportes con plantillas de issue. Del motor de uBO tomamos el índice por token, los filtros cosméticos genéricos aplicados según las clases e ids de la página, el respeto de `! Expires` y la página de advertencia (*strict blocking*). |
| [DuckDuckGo autoconsent](https://github.com/duckduckgo/autoconsent) | Biblioteca de reglas por proveedor de consentimiento (CMP) que rechaza los banners de cookies; incorpora reglas de Consent-O-Matic. | Reglas por CMP con selector de banner, botón de rechazar y botón de aceptar (`content/consent.js`). Si no se reconoce ningún botón, se oculta el banner. |
| [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) (Universidad de Aarhus) | Responde automáticamente a los banners de más de 200 CMP. Si no está seguro, elige la opción más privada. | Siempre se intenta primero **rechazar**; aceptar es el último recurso y se hace en sesión fantasma. |
| I still don't care about cookies | Oculta los banners con reglas cosméticas. | Ocultar el banner y desbloquear el scroll cuando no hay botones reconocibles. |
| [kewisch/action-web-ext](https://github.com/kewisch/action-web-ext) / `web-ext sign` | Lint, empaquetado y firma en AMO desde CI. | Workflow `release.yml`: al crear una etiqueta se firma (canal *unlisted*) y se publica el `.xpi`. |
| Dependabot | Actualiza las versiones de las Actions. | `.github/dependabot.yml`. |

## Por qué la «cookie fantasma» no falsifica cookies de consentimiento

La idea original era escribir cookies de consentimiento falsas con el valor «rechazado» (por ejemplo `OptanonConsent` de OneTrust o `CookieConsent` de Cookiebot). Se descartó por tres razones:

- Sus formatos no están documentados oficialmente y cambian según la configuración de cada sitio. En OneTrust, por ejemplo, los IDs de grupo dependen del sitio.
- Algunos CMP validan el consentimiento contra su servidor.
- Una cookie mal formada puede hacer que el banner aparezca en bucle.

Se eligió una alternativa más robusta:

1. Pulsar «Rechazar» cuando existe.
2. Si solo hay «Aceptar», aceptar dentro de una **sesión fantasma**: se descartan las cookies de terceros y, al salir del sitio, se borran sus cookies (incluidas las particionadas) y su `localStorage`.
3. Enviar la señal Global Privacy Control (`Sec-GPC: 1` y `navigator.globalPrivacyControl`).

## Ideas pendientes

- Prueba periódica con Playwright y Firefox en CI que abra YouTube y verifique que los selectores siguen existiendo, para detectar a tiempo cuando YouTube cambie su código.
- Recursos sustitutos (`$redirect=`): servir versiones vacías de scripts como Google Analytics o IMA en lugar de bloquearlos, para que los sitios no se rompan.
- Scriptlets `trusted-*` restantes (por ejemplo `trusted-edit-inbound-object`, que usan algunas correcciones de YouTube) y `href-sanitizer` avanzado.
- Repartir los datos de scriptlets por sitio en varios registros: hoy los sitios con scriptlets específicos cargan un bloque de unos 430 KB.
- Selectores procedurales (`:has-text`, `:upward`…).
- Descargar también las reglas de banners de cookies (CMP) desde el repositorio.
- Guardar el motor ya compilado para que Firefox arranque más rápido (hoy compila unas 290 000 reglas en ~0,3 s al iniciar).
- Soportar CMP dentro de Shadow DOM (Usercentrics) y de iframes de terceros (Sourcepoint).
- Publicar en AMO como extensión *listed* para que las actualizaciones lleguen solas. Las versiones *listed* pasan revisión manual.
