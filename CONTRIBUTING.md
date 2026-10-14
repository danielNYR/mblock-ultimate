# Cómo contribuir

¡Gracias! Lo que más ayuda es reportar anuncios, popups y banners de cookies que se escapan, y mantener actualizados los filtros.

## Preparar el entorno

```bash
npm test          # pruebas unitarias (Node 22+)
npm run lint      # web-ext lint
npm start         # abre Firefox con la extensión cargada
```

También puedes cargar `extension/manifest.json` desde `about:debugging` → «Cargar complemento temporal».

## Dónde está cada cosa

| Quiero… | Edita |
|---|---|
| Bloquear un dominio de anuncios o adware | `filtros/adware.txt` (con un comentario indicando dónde lo viste) |
| Bloquear una ruta u ocultar un elemento en un sitio | `filtros/reglas.txt` (sintaxis ABP/uBO: `sitio.com##.overlay`, `||cdn.xyz/ads/`) |
| Arreglar un sitio que una lista rompe | `filtros/excepciones.txt` (`@@…` o `sitio.com#@#.selector`) |
| Cambiar filtros integrados (siempre activos) | `extension/lib/lists.js` |
| Agregar una lista al catálogo | `LIST_CATALOG` en `extension/lib/lists.js` |
| Cambiar el motor de filtros | `extension/lib/filters.js` y `tests/filters.test.mjs` |
| Agregar un scriptlet | `extension/scriptlets/lib.js` y su alias en `SCRIPTLET_ALIASES` (`extension/lib/filters.js`) |
| Soportar un banner de cookies (CMP) nuevo | La lista `CMPS` en `extension/content/consent.js` |
| Arreglar YouTube | `COSMETIC["youtube.com"]` en `extension/lib/lists.js` y `YT_AD_KEYS` en `extension/background.js` |
| Arreglar Facebook | `extension/content/facebook.js` |

**No edites `listas/mblock.txt` a mano.** El workflow «Listas» lo regenera a partir de `filtros/`. `npm run check-lists` verifica que el motor entiende todas tus reglas; los selectores procedurales todavía no están soportados. Los scriptlets (`sitio.com##+js(set, propiedad, false)`) sí, salvo los que reescriben código, que la lista de la comunidad no puede usar.

## Proceso de revisión

El repositorio es abierto, pero **todo cambio necesita la aprobación del mantenedor** (ver [GOBERNANZA.md](GOBERNANZA.md)). El proceso es así:

1. Haz fork, crea una rama y abre un pull request contra `main` usando la plantilla.
2. Si es tu primera contribución, el CI esperará a que el mantenedor lo autorice.
3. El mantenedor revisa el cambio. Si pide ajustes, súbelos a la misma rama; cada cambio nuevo requiere una nueva aprobación.
4. Con la aprobación y el CI en verde, el mantenedor fusiona con *squash*.

## Lista de la comunidad

Los filtros de `filtros/` se publican compilados en `listas/mblock.txt` y la extensión se suscribe a ellos por defecto («MBlock Ultimate – Filtros de la comunidad» en Opciones). La URL es:

```
https://raw.githubusercontent.com/danielNYR/mblock-ultimate/main/listas/mblock.txt
```

## Reglas

- Ningún cambio puede enviar datos del usuario a terceros. La extensión solo descarga las listas configuradas.
- Los dominios nuevos en `filtros/adware.txt` deben ser redes de anuncios, popunders o rastreo, nunca un sitio completo de contenido.
- Mantén el código sin dependencias de ejecución. Las herramientas (`web-ext`) solo se usan en desarrollo.
- Los textos de la interfaz están en español.

## Publicar una versión (mantenedores)

1. Sube la versión en `extension/manifest.json` y en `package.json`, y agrega la entrada en `CHANGELOG.md`.
2. Crea la etiqueta: `git tag v1.3.0 && git push --tags`. Solo el mantenedor puede crear etiquetas `v*`.
3. El workflow «Release» prueba, empaqueta y firma (si están configurados los secretos `AMO_JWT_ISSUER` y `AMO_JWT_SECRET`), y crea la release con el `.xpi`.
