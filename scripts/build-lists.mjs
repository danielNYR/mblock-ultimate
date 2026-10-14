// Compila listas/mblock.txt, la lista de la comunidad, a partir de filtros/:
//   adware.txt      dominios (uno por línea) -> ||dominio^
//   reglas.txt      filtros en sintaxis ABP / uBlock Origin
//   excepciones.txt filtros de excepción (@@…, #@#…)
// Falla si alguna regla no la entiende el motor de la extensión, así CI
// detecta errores antes de que lleguen a los usuarios.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseDomainList, siteOf } = require("../extension/lib/domain.js");
globalThis.siteOf = siteOf;
const { FilterEngine } = require("../extension/lib/filters.js");

const root = new URL("../", import.meta.url);
const read = p => readFile(new URL(p, root), "utf8");
const checkOnly = process.argv.includes("--check");

const sections = [
  ["Dominios de adware", parseDomainList(await read("filtros/adware.txt")).sort().map(d => `||${d}^`)],
  ["Reglas", (await read("filtros/reglas.txt")).split(/\r?\n/)],
  ["Excepciones", (await read("filtros/excepciones.txt")).split(/\r?\n/)]
];

const errors = [];
for (const [name, lines] of sections) {
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith("!")) continue;
    const e = new FilterEngine();
    e.addList("x", l);
    if (e.stats.x.ignored) errors.push(`${name}: "${l}" no es compatible con el motor`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const version = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
const out = [
  "! Title: MBlock Ultimate – Filtros de la comunidad",
  "! Description: Reglas mantenidas por la comunidad de MBlock Ultimate (Moldhea)",
  `! Version: ${version}`,
  "! Expires: 2 days",
  "! License: GPL-3.0-or-later",
  "! Archivo generado por scripts/build-lists.mjs — no editar a mano; edita filtros/",
  ""
];
for (const [name, lines] of sections) {
  out.push(`! ---------- ${name} ----------`);
  out.push(...lines.map(l => l.trim()).filter(l => l && !l.startsWith("!")));
  out.push("");
}

const engine = FilterEngine.fromLists([{ id: "mblock", text: out.join("\n") }]);
const st = engine.stats.mblock;
if (!checkOnly) await writeFile(new URL("listas/mblock.txt", root), out.join("\n"));
console.log(`listas/mblock.txt: ${st.network} filtros de red, ${st.cosmetic} cosméticos${checkOnly ? " (solo verificación)" : ""}`);
