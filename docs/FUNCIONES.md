# MBlock Ultimate · Funciones

Referencia técnica de lo que hace cada parte de la extensión. Para empezar, lee el [README](../README.md).

## Funciones en detalle

| Función | Cómo funciona |
|---|---|
| **Motor de filtros** | Entiende la sintaxis de EasyList, uBlock Origin y AdGuard: bloqueo por dominio, ruta, comodines y regex; las opciones `$third-party`, `$script`, `$image`, `$xhr`, `$popup`, `$document`, `$domain=`, `$important` y `$badfilter`; excepciones `@@`; y reglas cosméticas genéricas, por sitio y por entidad (`google.*##…`), incluidas `:style()` y `:remove()`. Los filtros que no soporta (selectores procedurales, `$removeparam`, recursos `$redirect=`…) se ignoran sin romper nada. Las reglas cosméticas genéricas se aplican solo según las clases e ids que aparecen en cada página, como hace uBlock Origin. |
| **Scriptlets** | Ejecuta los scriptlets de las listas (`##+js(...)` de uBlock Origin y `#%#//scriptlet(...)` de AdGuard) en el contexto de la página y antes que sus scripts, incluso en sitios con CSP estricta. Incluye 30 scriptlets compatibles con uBO: `set-constant`, `abort-on-property-read`/`write`, `abort-current-script`, `abort-on-stack-trace`, `no-setTimeout-if`, `addEventListener-defuser`, `no-window-open-if`, `no-fetch-if`, `no-xhr-if`, `json-prune` (también en `fetch` y XHR), `remove-node-text`, `remove-attr`, `remove-class`, `set-cookie`, `set-local-storage-item` y otros. Con las listas por defecto se aplican unos 2 800 scriptlets, y así se esquivan los avisos de «desactiva tu bloqueador» y los anuncios que se inyectan con JavaScript. Los que reescriben código (`replace-node-text`) solo se aceptan de listas de confianza. |
| **Listas suscribibles** | Activadas por defecto: EasyList, EasyList Spanish, EasyPrivacy, Peter Lowe, uBlock filters, uBlock Quick fixes, uBlock Privacy, URLhaus (malware), Phishing URL Blocklist y uBlock Badware (unas 300 000 reglas). Opcionales: AdGuard Spanish/Portuguese, Fanboy's Annoyance y EasyList Cookie List. También puedes agregar listas por URL. Cada lista se actualiza sola según su cabecera `! Expires`. |
| **Advertencia de sitio peligroso** | Si abres un dominio de malware, de phishing o de una red de anuncios, aparece una página de advertencia que muestra el filtro y la lista responsables, con las opciones «Volver» y «Continuar de todas formas». |
| **Ocultamiento cosmético** | Oculta con CSS los huecos de anuncios comunes (AdSense, GPT, Taboola, Outbrain…). |
| **YouTube** | Quita los anuncios de la respuesta del reproductor antes de que llegue a la página (`adPlacements`, `playerAds`, `adSlots`). Si aun así aparece un anuncio, lo silencia, lo adelanta al final y pulsa «Omitir». También oculta banners y anuncios del feed. |
| **Facebook** | Oculta las publicaciones patrocinadas del feed y la sección «Patrocinado» de la columna derecha. |
| **Popups y redirecciones** | Un sitio solo puede abrir pestañas o redirigirte a: el mismo sitio, un **dominio seguro** o un enlace visible en el que hayas hecho clic tú. Esto cubre `window.open`, las capas transparentes que se ponen encima del reproductor (se desactivan con el primer clic), las redirecciones por script, `meta refresh` y las pestañas nuevas abiertas por la página (se cierran al momento). |
| **Red local** | Los sitios públicos no pueden conectarse a `localhost`, al router ni a otros equipos de tu red. Esto evita avisos como «quiere acceder a otras apps y servicios en este dispositivo». |
| **Notificaciones** | Rechaza automáticamente las peticiones de notificaciones push de los sitios que no son seguros. |
| **Banners de cookies** | Pulsa «Rechazar» o «Solo necesarias» en los banners de OneTrust, Cookiebot, Didomi, Quantcast, CookieYes, Complianz, Osano, iubenda, TrustArc, Klaro, Borlabs y Cookie Notice, además de los banners genéricos detectados por su texto. Si no hay botón para rechazar, oculta el banner y desbloquea el scroll. |
| **Cookies fantasma** | Si un sitio muestra un banner de cookies o pone demasiadas cookies (más de 20 por página o de más de 5 dominios de terceros), la pestaña entra en **sesión fantasma**: se descartan las cookies de terceros y, al cerrar la pestaña o salir del sitio, se borran todas sus cookies y su `localStorage`. Si el sitio solo deja ver el contenido al pulsar «Aceptar», se acepta dentro de esa sesión: puedes ver el contenido y el consentimiento desaparece al salir. |
| **Global Privacy Control** | Envía `Sec-GPC: 1` y `navigator.globalPrivacyControl = true`, que en varias jurisdicciones obliga legalmente a no vender ni compartir tus datos. |
| **Contador** | El icono muestra cuántos bloqueos hubo en la página actual. El popup muestra además el total. |

## Limitaciones conocidas

- **YouTube cambia su código con frecuencia.** Los nombres de los campos y los selectores pueden dejar de servir de un día para otro, y YouTube a veces muestra el aviso «los bloqueadores de anuncios no están permitidos». En ese caso, actualiza los selectores de YouTube en `extension/lib/lists.js` y `YT_AD_KEYS` en `background.js`, o desactiva «Anuncios de YouTube».
- **Facebook ofusca la etiqueta «Patrocinado».** Se combinan varias señales para detectarla, pero algún anuncio puede pasar.
- **Enlaces a otros sitios:** si haces clic en un enlace visible, se permite aunque el destino no sea un dominio seguro, porque la extensión entiende que esa navegación la quisiste tú. Una capa invisible o transparente no cuenta como enlace visible.
- **Escribir una URL o abrir un marcador** nunca se bloquea.
- No reemplaza todavía a uBlock Origin en todo: faltan los recursos sustitutos (`$redirect=`), los selectores procedurales y algunos scriptlets `trusted-*`.
- La guardia de red local no se aplica a los sitios de la lista de seguros, ni cuando la página que visitas está en tu propia red (por ejemplo, el panel de tu router).
- Usa Manifest V2 a propósito: Firefox lo sigue admitiendo y es lo que permite el bloqueo síncrono con `webRequest` y el filtrado de respuestas (`filterResponseData`) que se usa con YouTube.
- Solo funciona en Firefox; no es compatible con Chrome.
- **Netflix, Prime Video, Disney+, Max y similares:** en sus planes con anuncios, los anuncios vienen «cosidos» al mismo flujo de video cifrado (DRM) que la película. Una extensión no puede quitarlos sin romper la reproducción, y hacerlo viola sus términos de servicio. MBlock solo bloquea sus rastreadores y los banners de la interfaz que cubran las listas.
- **Cookies:** los banners dentro de Shadow DOM (Usercentrics) o de iframes de terceros (Sourcepoint) todavía no se manejan. Los sitios de la lista de dominios seguros nunca entran en sesión fantasma, para que conserves tus sesiones iniciadas. Firefox ya aísla las cookies de terceros con su Protección Total de Cookies; la sesión fantasma añade el borrado al salir del sitio.

## Estructura del código

```
extension/                 Lo que se empaqueta (Manifest V2, Firefox 142+)
  background.js            Bloqueo de red, guardia de navegación, red local, YouTube, cookies fantasma, GPC
  lib/filters.js           Motor de filtros (red + cosmético)
  lib/                     Utilidades de dominio, valores por defecto, filtros integrados y catálogo de listas
  content/cosmetic.js      Envía las clases/ids de la página para el CSS genérico
  content/scriptlet-loader.js  Entrega a la página los scriptlets que aplican al sitio
  scriptlets/lib.js        Biblioteca de scriptlets (corre en el contexto de la página)
  blocked/                 Página de advertencia
  content/guard.js         window.open, overlays, meta refresh, notificaciones, GPC
  content/consent.js       Banners de cookies
  content/youtube.js       Saltar anuncios en el reproductor
  content/facebook.js      Ocultar posts patrocinados
  popup/, options/         Interfaz
filtros/                   Filtros de la comunidad (adware.txt, reglas.txt, excepciones.txt)
listas/mblock.txt          Lista de la comunidad compilada (generada)
scripts/build-lists.mjs    Compilador de listas
tests/                     Pruebas (node --test)
```
