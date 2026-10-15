# Publicar MBlock Ultimate en addons.mozilla.org (AMO)

Todo lo que pide la ficha pública ya está en esta carpeta:

| Elemento | Dónde |
|---|---|
| Nombre, resumen y descripción (en, es-ES, es-MX), categoría, página web, licencia | [`metadata.json`](metadata.json) |
| Notas para los revisores de Mozilla (en inglés) | [`NOTAS-REVISION.md`](NOTAS-REVISION.md) |
| Política de privacidad | [`../PRIVACIDAD.md`](../PRIVACIDAD.md) |
| Capturas de 1280×800 | [`capturas/`](capturas) |
| Icono de 128×128 | [`../extension/icons/icon-128.png`](../extension/icons/icon-128.png) |

Datos de la ficha:

- **Categoría:** Privacidad y seguridad (`privacy-security`).
- **Licencia en AMO:** `GPL-3.0-only`. AMO no ofrece «or later». Publicar bajo GPL-3.0 es compatible con la licencia del repositorio.
- **Recolección de datos:** ninguna (`data_collection_permissions: ["none"]` en el manifest).
- **Versión mínima:** Firefox 142.

## 1. Una sola vez: cuenta y claves de la API

1. Inicia sesión en <https://addons.mozilla.org/developers/> con tu cuenta de Firefox y acepta el acuerdo de distribución.
2. Ve a **Tools → Manage API Keys** y genera unas credenciales. Obtendrás un *JWT issuer* y un *JWT secret*.
3. En GitHub ve a **Settings → Secrets and variables → Actions → New repository secret** y crea dos secretos:
   - `AMO_JWT_ISSUER`
   - `AMO_JWT_SECRET`

Las claves solo deben vivir en los secretos de GitHub. No las pegues en archivos, issues ni commits. Si llegaran a filtrarse, el escaneo de secretos y gitleaks bloquearían el push, pero aun así habría que revocarlas.

## 2. Enviar la versión

Sube la etiqueta de la versión (solo tú puedes crearla):

```bash
git tag v1.3.1 && git push origin v1.3.1
```

El workflow **Release**:

1. pasa todos los controles;
2. empaqueta la extensión;
3. la envía a AMO por el canal **listed**, con la ficha de `metadata.json` y las notas de la versión tomadas del CHANGELOG;
4. publica el `.zip` en GitHub Releases.

Si prefieres hacerlo a mano, en **Actions → Release → Run workflow** puedes elegir `listed` o `unlisted`. `unlisted` solo firma el `.xpi` para distribuirlo tú mismo.

## 3. Completar la ficha en el Developer Hub

Las capturas y la política de privacidad no se pueden enviar por la API. Después del primer envío, en **Developer Hub → MBlock Ultimate → Edit Product Page**:

1. **Images:** sube las 4 capturas de [`capturas/`](capturas) en orden.
2. **Privacy policy:** pega el contenido de [`PRIVACIDAD.md`](../PRIVACIDAD.md).
3. **Support:** URL <https://github.com/danielNYR/mblock-ultimate/issues> y, si quieres, un correo de soporte de Moldhea.
4. Revisa que el **Summary** y la **Description** en español e inglés hayan quedado bien.

## 4. Revisión de Mozilla

Las extensiones *listed* pasan una revisión. Por lo general es automática y tarda unos minutos, pero puede llegar a una revisión manual por los permisos amplios (`<all_urls>`, `webRequestBlocking`, `cookies`).

Las notas de [`NOTAS-REVISION.md`](NOTAS-REVISION.md) explican cada permiso y cómo probar la extensión. Se envían en `approval_notes`. Si Mozilla pide cambios, llegan por correo y al Developer Hub.

Una vez aprobada, la extensión queda en `https://addons.mozilla.org/firefox/addon/mblock-ultimate/` y Firefox la actualiza sola en cada versión nueva.

## Versiones siguientes

1. Agrega la sección de la versión en `CHANGELOG.md`.
2. Sube la versión en `extension/manifest.json` y `package.json`.
3. Crea la etiqueta `vX.Y.Z`. El workflow hace el resto.

## Regenerar las capturas

Las capturas se hicieron con Firefox headless (`firefox --headless --screenshot`) sobre las páginas reales de la extensión (popup, opciones, advertencia), con datos de ejemplo. Si cambias la interfaz, vuelve a generarlas con el mismo tamaño de 1280×800.
