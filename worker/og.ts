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

// Mirrors renderCanvas in src/lib/render.ts, scaled to fit a 1200×630 card.
async function previewSvg(env: Env, origin: string, spec: string) {
  const { spec: parsed, diagram } = validateSpec(JSON.parse(spec));
  const size = parsed.style?.pointSize ?? 24;
  const cellWidth = size * advanceEm;
  const rowHeight = size * rowHeightEm;
  const advance = Math.max(1, rowHeight + (parsed.style?.lineSpacing ?? 2));
  const margin = parsed.style?.border ?? 48;
  const background = parsed.style?.background ?? "#000000";
  const foreground = parsed.style?.foreground ?? "#f2f2f2";
  const cells = diagram.pngCells;
  const naturalWidth = (cells[0]?.length ?? 1) * cellWidth + 2 * margin;
  const naturalHeight = (cells.length - 1) * advance + rowHeight + 2 * margin;
  const scale = Math.min(width / naturalWidth, height / naturalHeight);
  const offsetX = (width - naturalWidth * scale) / 2 + margin * scale;
  const offsetY = (height - naturalHeight * scale) / 2 + margin * scale;

  const runs: string[] = [];
  cells.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const { glyph, color } = row[x];
      if (glyph === " ") { x++; continue; }
      let end = x + 1;
      while (end < row.length && row[end].glyph !== " " && row[end].color === color) end++;
      const text = row.slice(x, end).map(cell => cell.glyph).join("");
      runs.push(`<text x="${x * cellWidth}" y="${ascentEm * size + y * advance}" fill="${color ?? foreground}">${escape(text)}</text>`);
      x = end;
    }
  });

  const icons = await Promise.all(diagram.icons.map(async icon => {
    const svg = await iconSvg(icon.id, icon.color, async path => (await loadAsset(env, origin, path)).text());
    const boxWidth = icon.width * cellWidth;
    const boxHeight = icon.height * advance;
    const padding = Math.max(2, Math.min(boxWidth, boxHeight) * 0.1);
    const side = Math.min(boxWidth, boxHeight) - padding * 2;
    const x = icon.x * cellWidth + (boxWidth - side) / 2;
    const y = icon.y * advance + (boxHeight - side) / 2;
    return `<image x="${x}" y="${y}" width="${side}" height="${side}" href="data:image/svg+xml;base64,${btoa(svg)}"/>`;
  }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="${background}"/>`
    + `<g transform="translate(${offsetX} ${offsetY}) scale(${scale})" font-family="JetBrains Mono" font-size="${size}">${runs.join("")}${icons.join("")}</g>`
    + `</svg>`;
}

// Changes whenever the spec does, so link unfurlers refetch the image after an update.
export async function previewVersion(row: Row) {
  return (await hash(row.spec)).slice(0, 16);
}

export async function previewImage(env: Env, origin: string, row: Row, ctx: ExecutionContext) {
  // Keyed by spec hash; the caller has already checked the token, revocation and expiry.
  const key = new Request(new URL(`/__preview/${row.id}/${await previewVersion(row)}.png`, origin));
  const cache = await caches.open("previews");
  const cached = await cache.match(key);
  if (cached) return cached;
  const [, font] = await prepare(env, origin);
  const resvg = new Resvg(await previewSvg(env, origin, row.spec), {
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
    ["property", "og:url", page.href],
    ["property", "og:image", image.href],
    ["property", "og:image:type", "image/png"],
    ["property", "og:image:width", String(width)],
    ["property", "og:image:height", String(height)],
    ["property", "og:image:alt", row.title],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", row.title],
    ["name", "twitter:image", image.href],
  ].map(([attribute, name, content]) => `<meta ${attribute}="${name}" content="${escape(content)}" />`).join("");
  return new HTMLRewriter()
    .on("title", { element(element) { element.setInnerContent(`${row.title} · ascii-diagram`); } })
    .on("head", { element(element) { element.append(tags, { html: true }); } })
    .transform(shell);
}
