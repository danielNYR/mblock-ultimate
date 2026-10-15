// Genera dist/amo-metadata.json para `web-ext sign --amo-metadata`: la ficha
// de amo/metadata.json más las notas de la versión actual, tomadas de su
// sección en CHANGELOG.md.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = async p => readFile(new URL(p, root), "utf8");

const metadata = JSON.parse(await read("amo/metadata.json"));
const { version } = JSON.parse(await read("extension/manifest.json"));
const changelog = await read("CHANGELOG.md");

const start = changelog.indexOf(`## [${version}]`);
if (start < 0) throw new Error(`CHANGELOG.md no tiene la sección [${version}]`);
const next = changelog.indexOf("\n## [", start + 1);
const section = changelog.slice(start, next < 0 ? undefined : next)
  .split("\n").slice(1).join("\n").trim()
  .replace(/^### /gm, "")
  .replace(/\*\*/g, "");
if (!section) throw new Error(`La sección [${version}] de CHANGELOG.md está vacía`);

const notes = section.length > 3000 ? section.slice(0, 2990) + "…" : section;
metadata.version.release_notes = { "es-ES": notes, "es-MX": notes, "en-US": notes };

await mkdir(new URL("dist/", root), { recursive: true });
await writeFile(new URL("dist/amo-metadata.json", root), JSON.stringify(metadata, null, 2));
console.log(`dist/amo-metadata.json listo para la versión ${version}`);
