#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const libraryPath = join(skillDirectory, "references", "icon-library.json");
const rendererPath = join(skillDirectory, "scripts", "render_ascii_diagram.mjs");
const allowedUnicode = new Set([..."ƒ⋯▸⌸⌺⤖✶◔⊛⍟⟷⎋⊡⎕✓↻↑⇄↺∿×╭─╮│╰╯"]);

function displayWidth(value) {
  return [...value].length;
}

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = { check: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    if (argument === "--check") {
      options.check = true;
      continue;
    }

    if (argument === "--output") {
      const value = argv[index + 1];

      if (!value) {
        fail("--output needs a value");
      }

      options.output = value;
      index += 1;
      continue;
    }

    fail(`Unknown option: ${argument}`);
  }

  return options;
}

function printHelp() {
  process.stdout.write(`Usage:
  node render_icon_library.mjs [--output <base>]
  node render_icon_library.mjs [--output <base>] --check

The command validates the canonical icon library, then writes or checks a
JetBrains Mono text and PNG specimen through render_ascii_diagram.mjs.
`);
}

function assertSafeString(value, name, { asciiOnly = false } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${name} must be a non-empty string`);
  }

  if (/\p{Mark}|[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u.test(value)) {
    fail(`${name} contains a combining, zero-width, directional, or variation character`);
  }

  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint >= 0xe000 && codePoint <= 0xf8ff) {
      fail(`${name} contains a private-use character`);
    }

    if (codePoint >= 0x1f000) {
      fail(`${name} contains an emoji or supplementary pictograph`);
    }

    if (asciiOnly && codePoint > 0x7e) {
      fail(`${name} must use printable ASCII only`);
    }

    if (codePoint < 0x20 || codePoint === 0x7f) {
      fail(`${name} contains a control character`);
    }

    if (codePoint > 0x7e && !allowedUnicode.has(character)) {
      fail(`${name} contains a Unicode character outside the reviewed allowlist: ${character}`);
    }
  }
}

function validateLibrary(library) {
  if (library?.version !== 1) {
    fail("icon-library.json must use version 1");
  }

  if (!Number.isInteger(library.cell?.width) || !Number.isInteger(library.cell?.height)) {
    fail("cell width and height must be integers");
  }

  if (!Array.isArray(library.categories) || !Array.isArray(library.icons)) {
    fail("categories and icons must be arrays");
  }

  const categoryIds = new Set();

  for (const [index, category] of library.categories.entries()) {
    assertSafeString(category.id, `categories[${index}].id`, { asciiOnly: true });
    assertSafeString(category.label, `categories[${index}].label`, { asciiOnly: true });

    if (!/^#[0-9a-f]{6}$/i.test(category.color)) {
      fail(`categories[${index}].color must be a six-digit hexadecimal color`);
    }

    if (categoryIds.has(category.id)) {
      fail(`Duplicate category ID: ${category.id}`);
    }

    categoryIds.add(category.id);
  }

  const names = new Map();

  for (const [index, icon] of library.icons.entries()) {
    const prefix = `icons[${index}]`;
    assertSafeString(icon.id, `${prefix}.id`, { asciiOnly: true });
    assertSafeString(icon.label, `${prefix}.label`, { asciiOnly: true });
    assertSafeString(icon.mark, `${prefix}.mark`);
    assertSafeString(icon.fallbackMark, `${prefix}.fallbackMark`, { asciiOnly: true });

    if (!categoryIds.has(icon.category)) {
      fail(`${prefix}.category references an unknown category: ${icon.category}`);
    }

    if (!Array.isArray(icon.aliases) || !Array.isArray(icon.art)) {
      fail(`${prefix}.aliases and ${prefix}.art must be arrays`);
    }

    if (displayWidth(icon.mark) > library.cell.width - 2) {
      fail(`${prefix}.mark is wider than the badge interior`);
    }

    if (icon.art.length !== library.cell.height) {
      fail(`${prefix}.art must contain exactly ${library.cell.height} rows`);
    }

    for (const [rowIndex, row] of icon.art.entries()) {
      assertSafeString(row, `${prefix}.art[${rowIndex}]`);

      if (displayWidth(row) !== library.cell.width) {
        fail(`${prefix}.art[${rowIndex}] must be exactly ${library.cell.width} cells wide`);
      }

      if (row.endsWith(" ")) {
        fail(`${prefix}.art[${rowIndex}] cannot end with a space`);
      }
    }

    for (const name of [icon.id, ...icon.aliases]) {
      assertSafeString(name, `${prefix} name`, { asciiOnly: true });
      const existing = names.get(name);

      if (existing) {
        fail(`Name ${name} is shared by ${existing} and ${icon.id}`);
      }

      names.set(name, icon.id);
    }
  }
}

function categoryGroups(library) {
  return library.categories.map((category) => ({
    ...category,
    icons: library.icons.filter((icon) => icon.category === category.id),
  }));
}

function addIconItem(icons, texts, icon, centerX, iconY, color) {
  icons.push({ color, height: 3, id: icon.id, width: 5, x: centerX - 2, y: iconY });
  texts.push({ anchor: "center", color: "#f2f2f2", value: icon.label.toUpperCase(), x: centerX, y: iconY + 4 });
}

function buildSpec(library) {
  const groups = categoryGroups(library);
  const boxes = [];
  const icons = [];
  const texts = [
    { color: "#f2f2f2", value: "TERMINAL ICON LIBRARY", y: 0 },
    { color: "#94a3b8", value: `${library.icons.length} PINNED TABLER ICONS | JETBRAINS MONO FALLBACKS`, y: 1 },
  ];
  const requiredLabels = ["TERMINAL ICON LIBRARY", ...library.icons.map((icon) => icon.label.toUpperCase())];
  const canvasWidth = 108;
  const groupX = 2;
  const groupWidth = 104;
  const columns = 4;
  const centers = [15, 41, 67, 93];
  const rowHeight = 7;
  let y = 4;

  for (const group of groups) {
    const rows = Math.ceil(group.icons.length / columns);
    const groupHeight = rows * rowHeight + 2;
    boxes.push({
      borderColor: group.color,
      height: groupHeight,
      id: `group-${group.id}`,
      title: group.label.toUpperCase(),
      titleColor: group.color,
      width: groupWidth,
      x: groupX,
      y,
    });

    for (const [index, icon] of group.icons.entries()) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      addIconItem(icons, texts, icon, centers[column], y + 1 + row * rowHeight, group.color);
    }

    y += groupHeight + 2;
  }

  return {
    canvas: { height: y, width: canvasWidth },
    boxes,
    icons,
    requiredLabels,
    style: {
      background: "#000000",
      border: 48,
      foreground: "#f2f2f2",
      lineSpacing: 3,
      pointSize: 24,
    },
    texts,
  };
}

function runRenderer(spec, outputBase, check) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "ascii-icon-library-"));
  const specPath = join(temporaryDirectory, "icon-library.spec.json");

  try {
    writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    const args = [rendererPath, specPath, "--output", outputBase];

    if (check) {
      args.push("--check");
    }

    const result = spawnSync(process.execPath, args, { encoding: "utf8" });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      fail(result.stderr.trim() || `Renderer exited with status ${result.status}`);
    }

    process.stdout.write(result.stdout);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

const options = parseArguments(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const library = JSON.parse(readFileSync(libraryPath, "utf8"));
validateLibrary(library);
const outputBase = resolve(options.output ?? join(skillDirectory, "assets", "icon-library"));
runRenderer(buildSpec(library), outputBase, options.check);
process.stdout.write(`Validated ${library.icons.length} terminal icons from ${libraryPath}\n`);
