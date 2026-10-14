# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El proyecto sigue [versionado semántico](https://semver.org/lang/es/):

- **MAYOR:** cambios que rompen la configuración o el comportamiento esperado.
- **MENOR:** funciones nuevas.
- **PARCHE:** correcciones.

## [1.3.0] – 2026-10-14

### Agregado
- **Scriptlets:** se ejecutan los scriptlets de las listas, tanto `##+js(...)` de uBlock Origin como `#%#//scriptlet(...)` de AdGuard, en el contexto de la página y antes que sus scripts, incluso con CSP estricta. Incluye 30 scriptlets compatibles con uBO y sus alias.
- Excepciones de scriptlets (`#@#+js(...)` y `#@#+js()`). Los scriptlets que reescriben código solo se aceptan de listas de confianza.
- Listas activadas por defecto: uBlock filters, uBlock Quick fixes y uBlock Privacy.
- `json-prune` con eliminación de elementos de arreglos (`[-]`), usado por las correcciones de anuncios en Shorts.
- Interruptor «Scriptlets» en Opciones.

### Cambiado
- Nuevo logo e iconos, y paleta azul de la marca en toda la interfaz.

## [1.2.1] – 2026-10-14

### Corregido
- YouTube: los anuncios entraban al navegar dentro del sitio porque no se filtraba el endpoint `get_watch`. Ahora también se filtran `next` y los Shorts.
- YouTube: los anuncios se veían unos instantes antes de saltarse. Ahora el video se oculta en cuanto empieza un anuncio y el saltador reacciona al momento.
- Se oculta el aviso «los bloqueadores de anuncios no están permitidos».

## [1.2.0] – 2026-10-14

### Agregado
- Motor de filtros compatible con la sintaxis de EasyList, uBlock Origin y AdGuard: red, excepciones, opciones `$…`, filtros cosméticos genéricos, por sitio y por entidad.
- Catálogo de listas suscribibles con actualización automática según `! Expires`: EasyList Spanish, URLhaus, phishing y otras.
- Página de advertencia al abrir sitios de malware o phishing.
- «Mis filtros» con la sintaxis completa de las listas.
- Lista de la comunidad (`filtros/` → `listas/mblock.txt`) validada en CI.

## [1.1.0] – 2026-10-14

### Agregado
- Rechazo automático de banners de cookies de 12 proveedores, además de los banners genéricos.
- Sesiones fantasma: las cookies y el `localStorage` del sitio se borran al salir.
- Global Privacy Control (`Sec-GPC: 1`).
- Bloqueo del acceso de sitios públicos a la red local y negación de notificaciones push.
- Infraestructura de comunidad: CI, releases firmadas, plantillas de issue y licencia GPL-3.0.

## [1.0.0] – 2026-10-14

### Agregado
- Primera versión: bloqueo de anuncios por dominio, ocultamiento cosmético y manejo específico de YouTube y Facebook.
- Guardia de popups y redirecciones con lista de dominios seguros.
- Popup con contador y página de opciones.

[1.3.0]: ../../releases/tag/v1.3.0
[1.2.1]: ../../releases/tag/v1.2.1
[1.2.0]: ../../releases/tag/v1.2.0
[1.1.0]: ../../releases/tag/v1.1.0
[1.0.0]: ../../releases/tag/v1.0.0
