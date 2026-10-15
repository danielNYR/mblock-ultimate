# Política de privacidad de MBlock Ultimate

*Última actualización: 14 de octubre de 2026 · Responsable: Moldhea*

## Resumen

MBlock Ultimate **no recopila, no guarda fuera de tu navegador y no envía a nadie** información sobre ti ni sobre tu navegación. No tiene analíticas, telemetría, cuentas ni publicidad.

## Qué datos maneja y dónde quedan

| Dato | Para qué | Dónde queda |
|---|---|---|
| Tu configuración (funciones activas, dominios seguros, sitios desactivados, «Mis filtros», listas elegidas) | Que la extensión funcione como la configuraste | En tu navegador (`storage.local`) |
| Listas de filtros descargadas | Bloquear anuncios, rastreadores, malware y phishing | En tu navegador |
| Contadores de bloqueos | Mostrar cuántos elementos se bloquearon | En tu navegador |
| Lista de sitios en «sesión fantasma» pendientes de limpiar | Borrar sus cookies si Firefox se cerró antes de terminar | En tu navegador; se elimina después de la limpieza |

Las direcciones que visitas se usan solo en memoria, mientras se decide si bloquear una petición, y nunca se guardan ni se transmiten.

## Conexiones que realiza la extensión

La extensión solo se conecta para **descargar las listas de filtros** que tienes activadas en Opciones, por ejemplo EasyList, uBlock Origin, URLhaus, Phishing Army y la lista de la comunidad de MBlock en GitHub, además de las URLs que tú agregues. Estas descargas:

- se hacen sin cookies ni credenciales (`credentials: "omit"`);
- no incluyen ningún identificador tuyo ni datos de navegación;
- igual que cualquier descarga, el servidor de cada lista puede ver tu dirección IP. Puedes desactivar cualquier lista en Opciones.

## Funciones que modifican lo que ves o lo que guardan los sitios

Estas funciones actúan solo dentro de tu navegador y puedes desactivarlas en Opciones o por sitio:

- Ocultar anuncios y bloquear peticiones a dominios de publicidad, rastreo, malware y phishing.
- Responder automáticamente a los banners de cookies; primero intenta **rechazar**.
- **Sesión fantasma:** borrar las cookies y el `localStorage` de un sitio cuando sales de él. Los dominios seguros nunca se borran.
- Enviar la señal Global Privacy Control (`Sec-GPC: 1`), que pide a los sitios no vender ni compartir tus datos.

## Permisos

Los permisos de Firefox que solicita la extensión se usan exclusivamente para estas funciones. Su justificación detallada está en [amo/NOTAS-REVISION.md](amo/NOTAS-REVISION.md).

## Contacto

Puedes reportar dudas o problemas de privacidad en el [repositorio](https://github.com/danielNYR/mblock-ultimate/issues), o de forma privada desde *Security → Report a vulnerability*.

---

# Privacy policy (English)

MBlock Ultimate **does not collect, store outside your browser, or transmit** any personal or browsing data. It has no analytics, telemetry, accounts or ads.

- All settings, downloaded filter lists and counters are kept locally in `storage.local`.
- URLs are only evaluated in memory to decide whether a request should be blocked. They are never stored or sent anywhere.
- The only network connections made by the extension download the filter lists you enable in Options. These requests carry no cookies, credentials or identifiers; as with any download, the list's server can see your IP address.
- Content-modifying features (ad hiding, cookie-banner handling, "phantom session" cookie cleanup, Global Privacy Control) run locally and can be turned off globally or per site.
