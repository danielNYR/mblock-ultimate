#!/usr/bin/env bash
# Publica (si hace falta) y configura el repositorio de MBlock Ultimate en GitHub:
#   - Repositorio público: cualquiera puede ver, hacer fork, abrir issues y PRs.
#   - Nada entra a main sin tu aprobación (CODEOWNERS + reglas en .github/rulesets/).
#   - Los workflows de colaboradores externos esperan tu aprobación antes de ejecutarse.
#   - Solo tú puedes crear etiquetas vX.Y.Z (es decir, publicar versiones).
#
# Uso:  scripts/configurar-repo.sh [nombre | usuario/nombre]   (por defecto: mblock-ultimate)
# Requiere GitHub CLI con sesión iniciada:  brew install gh && gh auth login
# Es idempotente: puedes volver a ejecutarlo para reaplicar las reglas.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v gh >/dev/null || { echo "Falta GitHub CLI: brew install gh && gh auth login"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Inicia sesión primero: gh auth login"; exit 1; }

LOGIN="$(gh api user --jq .login)"
REPO="${1:-mblock-ultimate}"
[[ "$REPO" == */* ]] || REPO="$LOGIN/$REPO"
echo "→ Repositorio: $REPO (mantenedor: @$LOGIN)"

# 1. CODEOWNERS con tu usuario
perl -pi -e "s/^\* \@MANTENEDOR\b/* \@$LOGIN/" .github/CODEOWNERS
perl -pi -e "s#<usuario>/<repo>#$REPO#g" CONTRIBUTING.md
if ! git diff --quiet -- .github/CODEOWNERS CONTRIBUTING.md 2>/dev/null; then
  echo "  CODEOWNERS y CONTRIBUTING.md actualizados con tu usuario: haz commit de esos cambios."
fi

# 2. Crear el repositorio público si no existe
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  git rev-parse --verify HEAD >/dev/null 2>&1 || { echo "No hay commits todavía: haz el commit inicial y vuelve a ejecutar."; exit 1; }
  gh repo create "$REPO" --public --source . --remote origin --push \
    --description "Bloqueador de anuncios, malware, rastreo y redirecciones para Firefox, en español. Por Moldhea."
fi

# 3. Ajustes del repositorio (abierto a issues y PRs; solo squash; ramas borradas al fusionar)
gh repo edit "$REPO" \
  --enable-issues --enable-discussions --enable-wiki=false --enable-projects=false \
  --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false \
  --delete-branch-on-merge --allow-update-branch \
  --add-topic firefox-extension --add-topic adblock --add-topic privacy \
  --add-topic malware-protection --add-topic espanol

# 4. GitHub Actions: permisos mínimos; los PR de colaboradores externos esperan tu aprobación
gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true >/dev/null
gh api -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" \
  -f approval_policy=all_external_contributors >/dev/null

# 5. Reglas (rulesets): crea o actualiza las de .github/rulesets/
for file in .github/rulesets/*.json; do
  name="$(node -p "require('./$file').name")"
  id="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$name\") | .id" || true)"
  if [[ -n "$id" ]]; then
    gh api -X PUT "repos/$REPO/rulesets/$id" --input "$file" >/dev/null
    echo "  Regla actualizada: $name"
  else
    gh api -X POST "repos/$REPO/rulesets" --input "$file" >/dev/null
    echo "  Regla creada: $name"
  fi
done

# 6. Reportes privados de vulnerabilidades (ver SECURITY.md)
gh api -X PUT "repos/$REPO/private-vulnerability-reporting" >/dev/null || true

echo "✓ Listo: https://github.com/$REPO"
echo "  Recuerda agregar los secretos AMO_JWT_ISSUER y AMO_JWT_SECRET si quieres versiones firmadas automáticamente."
