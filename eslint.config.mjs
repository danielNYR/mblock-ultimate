// Análisis estático: reglas recomendadas de ESLint + reglas de SonarSource
// (eslint-plugin-sonarjs, las mismas que aplica SonarQube/SonarCloud a JS).
import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";

// Funciones y constantes que los scripts clásicos de la extensión comparten
// entre archivos (se cargan en el mismo contexto desde el manifest o el HTML).
const shared = {
  hostOf: "readonly", siteOf: "readonly", sameSite: "readonly", normalizeEntry: "readonly",
  hostInList: "readonly", hostInSet: "readonly", isPrivateHost: "readonly", parseDomainList: "readonly",
  DEFAULT_SETTINGS: "readonly", SETTING_KEYS: "readonly",
  BUILTIN_BLOCK_DOMAINS: "readonly", BUILTIN_NETWORK_RULES: "readonly", BUILTIN_FILTERS: "readonly",
  COSMETIC: "readonly", LIST_CATALOG: "readonly", FilterEngine: "readonly",
  __mbsG: "readonly", __mbsS: "readonly"
};

export default [
  { ignores: ["node_modules/", "dist/", "web-ext-artifacts/", "coverage/"] },
  js.configs.recommended,
  sonarjs.configs.recommended,
  {
    files: ["extension/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        exportFunction: "readonly", cloneInto: "readonly", module: "readonly",
        ...shared
      }
    },
    rules: {
      // las funciones de nivel superior se usan desde otros archivos del mismo contexto
      "no-unused-vars": ["error", { vars: "local", args: "after-used", caughtErrors: "none" }],
      "no-redeclare": ["error", { builtinGlobals: false }],
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } }
  },
  {
    // Las pruebas cargan los scripts de la extensión en contextos aislados (vm/jsdom)
    // y usan IPs privadas de ejemplo a propósito.
    files: ["tests/**/*.mjs"],
    rules: {
      "sonarjs/code-eval": "off",
      "sonarjs/no-hardcoded-ip": "off",
      "sonarjs/no-clear-text-protocols": "off"
    }
  }
];
