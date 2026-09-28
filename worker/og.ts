import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm?module";
import { iconSvg } from "../shared/icon-svg";
import { validateSpec } from "../shared/spec";
import { hash, type Env, type Row } from "./store";

const width = 1200;
const height = 630;
// JetBrains Mono, 1000 units per em: 600 advance, 1020 ascent, 300 descent.
const advanceEm = 0.6;
const ascentEm = 1.02;
const rowHeightEm = 1.32;

let wasmReady: Promise<void> | null = null;
let fontReady: Promise<Uint8Array> | null = null;

async function loadAsset(env: Env, origin: string, path: string) {
  const response = await env.ASSETS.fetch(new URL(path, origin));
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response;
}

function prepare(env: Env, origin: string) {
  wasmReady ??= initWasm(resvgWasm);
  fontReady ??= loadAsset(env, origin, "/fonts/JetBrainsMono-Regular.ttf").then(async response => new Uint8Array(await response.arrayBuffer()));
  fontReady.catch(() => { fontReady = null; });
  return Promise.all([wasmReady, fontReady]);
}

function escape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const padding = 48;
const header = 84;
const footer = 40;
const minScale = 0.62;
const maxScale = 1.3;

function truncate(value: string, length: number) {
  return [...value].length > length ? [...value].slice(0, length - 1).join("") + "…" : value;
}

// A 1200×630 card: a slim header, then the diagram on the dot grid. Big diagrams keep a
// readable scale and are cropped from the top-left with faded edges, not shrunk until the text disappears.
async function previewSvg(env: Env, origin: string, row: Row) {
  const { spec: parsed, diagram } = validateSpec(JSON.parse(row.spec));
  const size = parsed.style?.pointSize ?? 24;
  const cellWidth = size * advanceEm;
  const rowHeight = size * rowHeightEm;
  const advance = Math.max(1, rowHeight + (parsed.style?.lineSpacing ?? 2));
  const background = parsed.style?.background ?? "#000000";
  const foreground = parsed.style?.foreground ?? "#f2f2f2";
  const cells = diagram.pngCells;
  const naturalWidth = Math.max(1, cells[0]?.length ?? 1) * cellWidth;
  const naturalHeight = Math.max(0, cells.length - 1) * advance + rowHeight;

  const area = { x: padding, y: header + 20, width: width - padding * 2, height: height - header - 20 - footer };
  const fit = Math.min(area.width / naturalWidth, area.height / naturalHeight);
  const scale = Math.min(maxScale, Math.max(fit, minScale));
  const drawnWidth = naturalWidth * scale;
  const drawnHeight = naturalHeight * scale;
  const croppedX = drawnWidth > area.width + 0.5;
  const croppedY = drawnHeight > area.height + 0.5;
  // Diagrams read from the top-left, so a crop keeps that corner.
  const offsetX = croppedX ? area.x : area.x + (area.width - drawnWidth) / 2;
  const offsetY = croppedY ? area.y : area.y + (area.height - drawnHeight) / 2;

  const runs: string[] = [];
  cells.forEach((cellRow, y) => {
    let x = 0;
    while (x < cellRow.length) {
      const { glyph, color } = cellRow[x];
      if (glyph === " ") { x++; continue; }
      let end = x + 1;
      while (end < cellRow.length && cellRow[end].glyph !== " " && cellRow[end].color === color) end++;
      const text = cellRow.slice(x, end).map(cell => cell.glyph).join("");
      runs.push(`<text x="${x * cellWidth}" y="${ascentEm * size + y * advance}" fill="${color ?? foreground}">${escape(text)}</text>`);
      x = end;
    }
  });

  const icons = await Promise.all(diagram.icons.map(async icon => {
    const svg = await iconSvg(icon.id, icon.color, async path => (await loadAsset(env, origin, path)).text());
    const boxWidth = icon.width * cellWidth;
    const boxHeight = icon.height * advance;
    const inset = Math.max(2, Math.min(boxWidth, boxHeight) * 0.1);
    const side = Math.min(boxWidth, boxHeight) - inset * 2;
    const x = icon.x * cellWidth + (boxWidth - side) / 2;
    const y = icon.y * advance + (boxHeight - side) / 2;
    return `<image x="${x}" y="${y}" width="${side}" height="${side}" href="data:image/svg+xml;base64,${btoa(svg)}"/>`;
  }));

  const dotX = cellWidth * scale;
  const dotY = advance * scale;
  const fade = 90;
  const fades = [
    croppedX ? `<rect x="${area.x + area.width - fade}" y="${area.y}" width="${fade}" height="${area.height}" fill="url(#fadeRight)"/>` : "",
    croppedY ? `<rect x="${area.x}" y="${area.y + area.height - fade}" width="${area.width}" height="${fade}" fill="url(#fadeBottom)"/>` : "",
  ].join("");
  const title = escape(truncate(row.title, 52));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="JetBrains Mono">`
    + `<defs>`
    + `<clipPath id="area"><rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}"/></clipPath>`
    + `<pattern id="dots" width="${dotX}" height="${dotY}" patternUnits="userSpaceOnUse" x="${offsetX}" y="${offsetY}"><rect width="1.5" height="1.5" fill="#1f2a31"/></pattern>`
    + `<linearGradient id="fadeRight" x1="0" x2="1"><stop offset="0" stop-color="${background}" stop-opacity="0"/><stop offset="1" stop-color="${background}"/></linearGradient>`
    + `<linearGradient id="fadeBottom" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${background}" stop-opacity="0"/><stop offset="1" stop-color="${background}"/></linearGradient>`
    + `</defs>`
    + `<rect width="${width}" height="${height}" fill="${background}"/>`
    + `<text x="${padding}" y="54" font-size="26"><tspan fill="#79bdff">[</tspan><tspan fill="#e8e8e5"> ascii-diagram </tspan><tspan fill="#79bdff">]</tspan></text>`
    + `<text x="${width - padding}" y="54" font-size="24" fill="#929da7" text-anchor="end">${title}</text>`
    + `<rect x="0" y="${header}" width="${width}" height="1" fill="#64717c" fill-opacity="0.35"/>`
    + `<g clip-path="url(#area)"><rect x="${area.x}" y="${area.y}" width="${area.width}" height="${area.height}" fill="url(#dots)"/>`
    + `<g transform="translate(${offsetX} ${offsetY}) scale(${scale})" font-size="${size}">${runs.join("")}${icons.join("")}</g></g>`
    + fades
    + `</svg>`;
}

export function previewDescription(row: Row) {
  try {
    const spec = JSON.parse(row.spec) as { boxes?: unknown[]; connectors?: unknown[]; lines?: unknown[]; texts?: { value: string }[] };
    const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : noun.endsWith("x") ? "es" : "s"}`;
    const parts = [count(spec.boxes?.length ?? 0, "box"), count((spec.connectors?.length ?? 0) + (spec.lines?.length ?? 0), "connection")];
    const lead = spec.texts?.find(text => text.value.trim().length > 3)?.value.trim();
    return `${lead ? `${truncate(lead, 90)} · ` : ""}${parts.join(" · ")}. An ASCII architecture diagram.`;
  } catch {
    return "An ASCII architecture diagram.";
  }
}

// Bump when the card design changes so cached images are regenerated.
const design = "card-3";

// Changes whenever the spec does, so link unfurlers refetch the image after an update.
export async function previewVersion(row: Row) {
  return (await hash(`${design}:${row.title}:${row.spec}`)).slice(0, 16);
}

export async function previewImage(env: Env, origin: string, row: Row, ctx: ExecutionContext) {
  // Keyed by spec hash; the caller has already checked the token, revocation and expiry.
  const key = new Request(new URL(`/__preview/${row.id}/${await previewVersion(row)}.png`, origin));
  const cache = await caches.open("previews");
  const cached = await cache.match(key);
  if (cached) return cached;
  const [, font] = await prepare(env, origin);
  const resvg = new Resvg(await previewSvg(env, origin, row), {
    fitTo: { mode: "original" },
    font: { fontBuffers: [font], loadSystemFonts: false, defaultFontFamily: "JetBrains Mono" },
  });
  const rendered = resvg.render();
  const png = new Uint8Array(rendered.asPng());
  rendered.free();
  resvg.free();
  const response = new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" } });
  ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}

export async function withPreviewTags(shell: Response, page: URL, row: Row) {
  const image = new URL(`/d/${row.id}/og.png`, page.origin);
  image.searchParams.set("token", page.searchParams.get("token") ?? "");
  image.searchParams.set("v", await previewVersion(row));
  const tags = [
    ["property", "og:type", "website"],
    ["property", "og:site_name", "ascii-diagram"],
    ["property", "og:title", row.title],
    ["property", "og:description", previewDescription(row)],
    ["name", "description", previewDescription(row)],
    ["property", "og:url", page.href],
    ["property", "og:image", image.href],
    ["property", "og:image:secure_url", image.href],
    ["property", "og:image:type", "image/png"],
    ["property", "og:image:width", String(width)],
    ["property", "og:image:height", String(height)],
    ["property", "og:image:alt", row.title],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", row.title],
    ["name", "twitter:description", previewDescription(row)],
    ["name", "twitter:image", image.href],
  ].map(([attribute, name, content]) => `<meta ${attribute}="${name}" content="${escape(content)}" />`).join("");
  return new HTMLRewriter()
    .on("title", { element(element) { element.setInnerContent(`${row.title} · ascii-diagram`); } })
    .on("head", { element(element) { element.append(tags, { html: true }); } })
    .transform(shell);
}
