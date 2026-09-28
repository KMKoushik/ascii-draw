import { loadCatalogIcon, loadSvgIconLibrary, type Diagram, type IconElement } from "../../shared/engine.js";
import type { Spec } from "../../shared/spec";

function escape(value: string | number) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function elementSvg(element: IconElement) {
  const { type, ...attributes } = element;
  return `<${type} ${Object.entries(attributes).map(([key, value]) => `${key}="${escape(value)}"`).join(" ")}/>`;
}
async function iconImage(id: string, color: string) {
  const library = loadSvgIconLibrary();
  const definition = library.icons[id] ?? loadCatalogIcon(id);
  let svg: string;
  if (definition.asset) {
    const response = await fetch(definition.asset);
    if (!response.ok) throw new Error(`Could not load icon ${id}`);
    svg = (await response.text()).replaceAll("currentColor", color);
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${definition.elements!.map(elementSvg).join("")}</svg>`;
    svg = svg.replaceAll("currentColor", color);
  }
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

// Rasterization is browser-native; the grid, routing, colors and icon reservations
// come directly from the skill's shared engine. No server-side image is stored.
export async function renderCanvas(spec: Spec, diagram: Diagram) {
  const size = spec.style?.pointSize ?? 24;
  await document.fonts.load(`${size}px "JetBrains Mono"`);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser does not support canvas rendering");
  context.font = `${size}px "JetBrains Mono"`;
  const metrics = context.measureText("M");
  const cellWidth = metrics.width;
  const ascent = metrics.fontBoundingBoxAscent ?? size * 1.05;
  const descent = metrics.fontBoundingBoxDescent ?? size * 0.3;
  const rowHeight = ascent + descent;
  const advance = Math.max(1, rowHeight + (spec.style?.lineSpacing ?? 2));
  const margin = spec.style?.border ?? 48;
  const cells = diagram.pngCells;
  canvas.width = Math.ceil((cells[0]?.length ?? 1) * cellWidth + 2 * margin);
  canvas.height = Math.ceil((cells.length - 1) * advance + rowHeight + 2 * margin);
  if (canvas.width * canvas.height > 16_000_000) throw new Error("Rendered image exceeds 16 megapixels");
  context.fillStyle = spec.style?.background ?? "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = `${size}px "JetBrains Mono"`;
  context.textBaseline = "alphabetic";
  for (let y = 0; y < cells.length; y++) {
    for (let x = 0; x < cells[y].length; x++) {
      const cell = cells[y][x];
      if (cell.glyph === " ") continue;
      context.fillStyle = cell.color ?? spec.style?.foreground ?? "#f2f2f2";
      context.fillText(cell.glyph, margin + x * cellWidth, margin + ascent + y * advance);
    }
  }
  const images = await Promise.all(diagram.icons.map(icon => iconImage(icon.id, icon.color)));
  diagram.icons.forEach((icon, i) => {
    const width = icon.width * cellWidth;
    const height = icon.height * advance;
    const padding = Math.max(2, Math.min(width, height) * 0.1);
    const size = Math.min(width, height) - padding * 2;
    context.drawImage(images[i], margin + icon.x * cellWidth + (width - size) / 2, margin + icon.y * advance + (height - size) / 2, size, size);
  });
  return canvas;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function saveText(content: string, filename: string, type = "text/plain") {
  saveBlob(new Blob([content], { type }), filename);
}
export async function savePng(canvas: HTMLCanvasElement, filename: string) {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not export the PNG");
  saveBlob(blob, filename);
}
