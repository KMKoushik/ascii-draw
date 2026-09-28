// Extract the skill's exact character-grid engine. No layout algorithm is reimplemented.
// The generated engine is committed, so builds and deployments do not need the skill.
import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const skill = process.env.ASCII_SKILL_DIR ?? join(homedir(), ".agents/skills/ascii-diagram-png");
const source = await readFile(join(skill, "scripts/render_ascii_diagram.mjs"), "utf8");
const start = source.indexOf("const NORTH = 1;");
const end = source.indexOf("function parseArguments(");
if (start < 0 || end < 0) throw new Error("Skill renderer structure has changed; review the port.");
let core = source.slice(start, end);
const loadersStart = core.indexOf("function loadTextIconMarks()");
const loadersEnd = core.indexOf("class TerminalCanvas");
core = core.slice(0, loadersStart) + `
function loadSvgIconLibrary() { return iconLibrary; }
function loadCatalogIcon(id) {
  if (!catalog.has(id)) throw new Error('Unknown SVG icon: ' + id);
  return { mark: '<>', variant: id.split('/')[0], asset: '/icons/' + id + '.svg' };
}
` + core.slice(loadersEnd);
// Avoid mutable global state accumulating catalog entries inside a Worker isolate.
core = core.replace('const library = loadSvgIconLibrary();\n  const placements', 'const library = { icons: { ...loadSvgIconLibrary().icons } };\n  const placements');
await mkdir("shared", { recursive: true });
await mkdir("public/fonts", { recursive: true });
await mkdir("public/licenses", { recursive: true });
const library = JSON.parse(await readFile(join(skill, "assets/svg-icon-library.json"), "utf8"));
const textIcons = JSON.parse(await readFile(join(skill, "references/icon-library.json"), "utf8"));
for (const [id, definition] of Object.entries(library.icons)) {
  definition.mark = textIcons.icons.find(icon => icon.id === (definition.textIconId ?? id)).mark;
}
await writeFile("shared/icon-library.json", JSON.stringify(library));
const ids = [];
for (const variant of ["outline", "filled"]) {
  const dir = `node_modules/@tabler/icons/icons/${variant}`;
  for (const file of await readdir(dir)) if (file.endsWith('.svg')) ids.push(`${variant}/${file.slice(0,-4)}`);
  await cp(dir, `public/icons/${variant}`, { recursive: true });
}
await writeFile("shared/icon-catalog.json", JSON.stringify(ids));
await writeFile("shared/engine.js", `// Generated from ascii-diagram-png by scripts/sync-renderer.mjs.\nimport iconLibrary from './icon-library.json';\nimport iconIds from './icon-catalog.json';\nconst catalog = new Set(iconIds);\n${core}\nexport { buildDiagram, loadSvgIconLibrary, loadCatalogIcon, measureBox, resolvePath, normalizePathPoints, ensureArrowApproach, inferArrow, displayWidth };\n`);
await cp(join(skill, "assets/JetBrainsMono-Regular.ttf"), "public/fonts/JetBrainsMono-Regular.ttf");
await cp(join(skill, "assets/JetBrainsMono-OFL.txt"), "public/licenses/JetBrainsMono-OFL.txt");
await cp(join(skill, "assets/TABLER-ICONS-LICENSE.txt"), "public/licenses/TABLER-ICONS-LICENSE.txt");
await cp(join(skill, "references/spec-format.md"), "public/spec-format.md");
console.log(`Synced grid engine, JetBrains Mono, and ${ids.length} Tabler icons.`);
