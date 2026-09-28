import type { Diagram } from "../../shared/engine.js";
import { iconSvg } from "../../shared/icon-svg";
import type { Spec } from "../../shared/spec";

async function iconImage(id: string, color: string) {
  const svg = await iconSvg(id, color, async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load icon ${id}`);
    return response.text();
  });
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

const iconRequests = new Map<string, Promise<HTMLImageElement>>();
const iconImages = new Map<string, HTMLImageElement>();
export function loadIcon(id: string, color: string) {
  const key = `${id}|${color}`;
  let request = iconRequests.get(key);
  if (!request) {
    request = iconImage(id, color).then(image => { iconImages.set(key, image); return image; });
    request.catch(() => iconRequests.delete(key));
    iconRequests.set(key, request);
  }
  return request;
}
export function loadedIcon(id: string, color: string) {
  return iconImages.get(`${id}|${color}`) ?? null;
}

export type Metrics = { size: number; cellWidth: number; ascent: number; rowHeight: number; advance: number };
export function measureFont(context: CanvasRenderingContext2D, size: number, lineSpacing: number): Metrics {
  context.font = `${size}px "JetBrains Mono"`;
  const metrics = context.measureText("M");
  const ascent = metrics.fontBoundingBoxAscent ?? size * 1.05;
  const descent = metrics.fontBoundingBoxDescent ?? size * 0.3;
  const rowHeight = ascent + descent;
  return { size, cellWidth: metrics.width, ascent, rowHeight, advance: Math.max(1, rowHeight + lineSpacing) };
}

export function paintCells(context: CanvasRenderingContext2D, cells: Diagram["pngCells"], metrics: Metrics, originX: number, originY: number, foreground: string) {
  context.font = `${metrics.size}px "JetBrains Mono"`;
  context.textBaseline = "alphabetic";
  for (let y = 0; y < cells.length; y++) {
    for (let x = 0; x < cells[y].length; x++) {
      const cell = cells[y][x];
      if (cell.glyph === " ") continue;
      context.fillStyle = cell.color ?? foreground;
      context.fillText(cell.glyph, originX + x * metrics.cellWidth, originY + metrics.ascent + y * metrics.advance);
    }
  }
}

export function paintIcon(context: CanvasRenderingContext2D, image: HTMLImageElement, icon: Diagram["icons"][number], metrics: Metrics, originX: number, originY: number) {
  const width = icon.width * metrics.cellWidth;
  const height = icon.height * metrics.advance;
  const padding = Math.max(2, Math.min(width, height) * 0.1);
  const size = Math.min(width, height) - padding * 2;
  context.drawImage(image, originX + icon.x * metrics.cellWidth + (width - size) / 2, originY + icon.y * metrics.advance + (height - size) / 2, size, size);
}

// Rasterization is browser-native; the grid, routing, colors and icon reservations
// come directly from the skill's shared engine. No server-side image is stored.
export async function renderCanvas(spec: Spec, diagram: Diagram) {
  const size = spec.style?.pointSize ?? 24;
  await document.fonts.load(`${size}px "JetBrains Mono"`);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser does not support canvas rendering");
  const metrics = measureFont(context, size, spec.style?.lineSpacing ?? 2);
  const margin = spec.style?.border ?? 48;
  const cells = diagram.pngCells;
  canvas.width = Math.ceil((cells[0]?.length ?? 1) * metrics.cellWidth + 2 * margin);
  canvas.height = Math.ceil((cells.length - 1) * metrics.advance + metrics.rowHeight + 2 * margin);
  if (canvas.width * canvas.height > 16_000_000) throw new Error("Rendered image exceeds 16 megapixels");
  context.fillStyle = spec.style?.background ?? "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  paintCells(context, cells, metrics, margin, margin, spec.style?.foreground ?? "#f2f2f2");
  const images = await Promise.all(diagram.icons.map(icon => loadIcon(icon.id, icon.color)));
  diagram.icons.forEach((icon, i) => paintIcon(context, images[i], icon, metrics, margin, margin));
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
