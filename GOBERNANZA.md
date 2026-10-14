# Gobernanza

MBlock Ultimate es un proyecto **abierto** y con **un solo mantenedor que aprueba todo lo que entra**. Cualquiera puede ver el código, hacer fork, reportar problemas y proponer cambios, pero nada llega a la rama `main` ni a una versión publicada sin la autorización del mantenedor (Moldhea).

## Qué puede hacer cada quien

| Acción | Cualquier persona | Mantenedor |
|---|---|---|
| Ver y clonar el código, hacer fork | ✅ | ✅ |
| Abrir issues y participar en Discussions | ✅ | ✅ |
| Abrir pull requests | ✅ | ✅ |
| Ejecutar CI en su pull request | ⏳ tras la aprobación del mantenedor | ✅ |
| Fusionar cambios a `main` | ❌ | ✅ |
| Publicar versiones (etiquetas `vX.Y.Z`) | ❌ | ✅ |
| Cambiar estas reglas | ❌ | ✅ |

## Cómo se aplica

Las reglas no dependen de la buena voluntad: GitHub las hace cumplir, y están versionadas en el repositorio.

- **[`.github/CODEOWNERS`](.github/CODEOWNERS):** el mantenedor es dueño de todos los archivos, así que su revisión es obligatoria en cualquier pull request.
- **[`.github/rulesets/main.json`](.github/rulesets/main.json):** para fusionar a `main` se necesita lo siguiente:
  - un pull request con 1 aprobación del dueño del código;
  - una nueva aprobación si alguien sube cambios después de aprobado;
  - todas las conversaciones resueltas;
  - el CI (`test`) en verde;
  - historial lineal, fusionando solo con *squash*.

  Además, nadie puede forzar el push ni borrar la rama.
- **[`.github/rulesets/etiquetas.json`](.github/rulesets/etiquetas.json):** solo el mantenedor puede crear, mover o borrar etiquetas `v*`. Como cada etiqueta dispara una versión firmada, nadie más puede publicar.
- **GitHub Actions:**
  - Los workflows de un pull request de un colaborador externo no se ejecutan hasta que el mantenedor los aprueba, así nadie puede usar el CI para ejecutar código sin revisión.
  - Los workflows tienen permisos de solo lectura por defecto.
- **Excepción:** el rol de administrador (el mantenedor) puede saltarse las reglas para mantenimiento urgente.

Para aplicar o volver a aplicar todo esto en GitHub, ejecuta [`scripts/configurar-repo.sh`](scripts/configurar-repo.sh). Para cambiar una regla, edita el JSON de `.github/rulesets/` y vuelve a ejecutar el script.

## Criterios para aceptar cambios

1. **Privacidad:** ningún cambio puede enviar datos del usuario a terceros ni agregar telemetría.
2. **Seguridad:** no se aceptan dependencias de ejecución, código ofuscado ni descargas de código remoto. Las listas de filtros son datos, no código.
3. **Filtros:** cada regla nueva en `filtros/` debe decir dónde se observó el problema, y no puede bloquear sitios completos de contenido legítimo.
4. **Calidad:** deben pasar `npm test`, `npm run lint` y `npm run check-lists`, y el cambio debe estar probado en Firefox.
5. **Alcance:** el objetivo es «navegar seguro en cualquier sitio, en español». No se aceptan funciones para saltarse muros de pago ni anuncios de servicios de pago.

## Versiones

El mantenedor decide cuándo publicar. El proceso está en [CONTRIBUTING.md](CONTRIBUTING.md#publicar-una-versión-mantenedores) y los cambios se registran en [CHANGELOG.md](CHANGELOG.md).
