#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function parseAttributes(value) {
  const attributes = new Map();
  let rest = value.trim();
  while (rest) {
    const match = /^([A-Za-z][\w:-]*)\s*=\s*(["'])(.*?)\2\s*/s.exec(rest);
    if (!match || attributes.has(match[1]) || /[<&]/.test(match[3])) {
      throw new Error("Unsupported SVG attribute syntax");
    }
    attributes.set(match[1], match[3]);
    rest = rest.slice(match[0].length);
  }
  return attributes;
}

// Only the pinned catalog's flat SVG path format is accepted.
export function parseTablerSvg(svg, variant) {
  if (!["outline", "filled"].includes(variant)) {
    throw new Error("Unsupported Tabler variant");
  }
  const root = /^\s*<svg\s+([^>]+)>([\s\S]*)<\/svg>\s*$/.exec(svg);
  if (!root || parseAttributes(root[1]).get("viewBox") !== "0 0 24 24") {
    throw new Error("Unsupported Tabler SVG root or viewBox");
  }
  const elements = [];
  let rest = root[2].trim();
  while (rest) {
    const match = /^<path\s+([^>]*?)\s*\/>(\s*)/.exec(rest);
    if (!match) {
      throw new Error("Unsupported Tabler SVG element");
    }
    rest = rest.slice(match[0].length);
    const attributes = parseAttributes(match[1]);
    for (const name of attributes.keys()) {
      if (!["d", "fill", "stroke", "opacity"].includes(name)) {
        throw new Error(`Unsupported SVG path attribute: ${name}`);
      }
    }
    if (!attributes.get("d")) {
      throw new Error("Empty SVG path");
    }
    for (const name of ["fill", "stroke"]) {
      if (attributes.has(name) && !["none", "currentColor"].includes(attributes.get(name))) {
        throw new Error(`Unsupported SVG paint: ${name}`);
      }
    }
    if (attributes.get("fill") === "none" && attributes.get("stroke") === "none") {
      continue;
    }
    const element = { type: "path", ...Object.fromEntries(attributes) };
    if (attributes.has("opacity")) {
      const opacity = Number(attributes.get("opacity"));
      if (!attributes.get("opacity").trim() || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
        throw new Error("Invalid SVG opacity");
      }
      element.opacity = opacity;
    }
    elements.push(element);
  }
  if (elements.length === 0) {
    throw new Error("Empty Tabler icon");
  }
  return { variant, elements };
}

async function main() {
  if (process.argv.length !== 3) {
    throw new Error("Usage: node fetch_tabler_icons.mjs <spec.json>");
  }
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const library = JSON.parse(readFileSync(join(root, "assets", "svg-icon-library.json"), "utf8"));
  const version = library.source.version;
  const cache = process.env.TABLER_ICON_CACHE ?? join(homedir(), ".cache", "ascii-diagram-png", "tabler", version);
  const known = new Set(readFileSync(join(root, "references", "tabler-catalog.tsv"), "utf8").trim().split("\n").slice(1).map((line) => line.split("\t")[0]));
  const spec = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8"));
  const ids = [...new Set((spec.icons ?? []).map((icon) => icon.id))].sort();
  for (const id of ids) {
    if (!known.has(id) && !Object.hasOwn(library.icons, id)) {
      throw new Error(`Unknown icon ID: ${id}`);
    }
  }
  for (const id of ids) {
    if (Object.hasOwn(library.icons, id)) continue;
    const target = join(cache, `${id}.json`);
    if (existsSync(target)) {
      process.stdout.write(`Cached: ${id}\n`);
      continue;
    }
    const url = `https://cdn.jsdelivr.net/npm/@tabler/icons@${version}/icons/${id}.svg`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      throw new Error(`Could not fetch ${id}: HTTP ${response.status}. Retry preparation later; existing cached icons are unchanged.`);
    }
    const definition = parseTablerSvg(await response.text(), id.split("/")[0]);
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(definition)}\n`);
    renameSync(temporary, target);
    process.stdout.write(`Fetched: ${id}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
