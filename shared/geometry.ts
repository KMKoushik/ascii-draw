import { displayWidth, ensureArrowApproach, inferArrow, measureBox, normalizePathPoints, resolvePath, type MeasuredBox, type Point, type Port } from "./engine.js";
import { validateSpec, type Spec } from "./spec";

export type Rect = { x: number; y: number; width: number; height: number };
export type ElementKind = "box" | "text" | "icon" | "connector" | "line" | "arrow";
export type ElementRef = { kind: ElementKind; index: number };
export type Geometry = {
  boxes: Rect[];
  boxById: Map<string, MeasuredBox>;
  texts: Rect[];
  icons: Rect[];
  connectors: Point[][];
  lines: Point[][];
  arrows: Rect[];
};
export type { Point, Port };

export const emptySpec: Spec = { canvas: { width: 4, height: 3 } };

export function isEmpty(spec: Spec) {
  return !spec.boxes?.length && !spec.texts?.length && !spec.icons?.length && !spec.connectors?.length && !spec.lines?.length && !spec.arrows?.length;
}

type Text = NonNullable<Spec["texts"]>[number];
export function textX(text: Text, canvasWidth: number) {
  const width = displayWidth(text.value);
  if (text.x === undefined) return Math.floor((canvasWidth - width) / 2);
  if (text.anchor === "center") return text.x - Math.floor(width / 2);
  if (text.anchor === "right") return text.x - width + 1;
  return text.x;
}

function rectOf({ x, y, width, height }: Rect): Rect {
  return { x, y, width, height };
}

// Uses the engine's own box measurement and routing so hit targets match what is drawn.
export function geometry(spec: Spec): Geometry {
  const measured = (spec.boxes ?? []).map(box => measureBox(box));
  const boxById = new Map<string, MeasuredBox>();
  for (const box of measured) if (box.id) boxById.set(box.id, box);
  const connectors = (spec.connectors ?? []).map(connector => {
    const { points, targetPort } = resolvePath(connector, boxById);
    const normalized = normalizePathPoints(points);
    return ensureArrowApproach(normalized, connector.arrow ?? inferArrow(normalized, targetPort));
  });
  return {
    boxes: measured.map(rectOf),
    boxById,
    texts: (spec.texts ?? []).map(text => ({ x: textX(text, spec.canvas.width), y: text.y, width: displayWidth(text.value), height: 1 })),
    icons: (spec.icons ?? []).map(rectOf),
    connectors,
    lines: (spec.lines ?? []).map(line => resolvePath(line, boxById).points),
    arrows: (spec.arrows ?? []).map(arrow => ({ x: arrow.x, y: arrow.y, width: 1, height: 1 })),
  };
}

export function requiredBoxSize(box: NonNullable<Spec["boxes"]>[number]) {
  const { width, height } = measureBox({ ...box, width: undefined, height: undefined, x: box.x ?? 0 });
  return { width, height };
}

// Pin centred/anchored items to explicit coordinates so resizing the canvas never moves them.
export function normalize(input: Spec): Spec {
  const spec = structuredClone(input);
  const ids = new Set((spec.boxes ?? []).map(box => box.id).filter(Boolean));
  let next = 1;
  spec.boxes = (spec.boxes ?? []).map(box => {
    const result = { ...box };
    if (!result.id) {
      while (ids.has(`box-${next}`)) next++;
      result.id = `box-${next}`;
      ids.add(result.id);
    }
    if (result.x === undefined) result.x = measureBox(box).x;
    delete result.centerX;
    return result;
  });
  spec.texts = (spec.texts ?? []).map(text => {
    if (text.x !== undefined && (!text.anchor || text.anchor === "left")) return text;
    const { anchor: _anchor, ...rest } = text;
    return { ...rest, x: textX(text, spec.canvas.width) };
  });
  for (const key of ["boxes", "texts", "icons", "connectors", "lines", "arrows"] as const) {
    if (!spec[key]?.length) delete spec[key];
  }
  return spec;
}

export function fitCanvas(spec: Spec) {
  const g = geometry(spec);
  let width = 4;
  let height = 3;
  for (const rect of [...g.boxes, ...g.texts, ...g.icons, ...g.arrows]) {
    width = Math.max(width, rect.x + rect.width);
    height = Math.max(height, rect.y + rect.height);
  }
  for (const path of [...g.connectors, ...g.lines]) {
    for (const [x, y] of path) {
      width = Math.max(width, x + 1);
      height = Math.max(height, y + 1);
    }
  }
  return { width, height };
}

// Produces a valid, self-consistent spec for a drawing edit, or throws the engine's error.
export function finalize(input: Spec) {
  const spec = normalize(input);
  const labels = spec.requiredLabels;
  delete spec.requiredLabels;
  spec.canvas = fitCanvas(spec);
  const result = validateSpec(spec);
  const kept = labels?.filter(label => result.diagram.text.includes(label));
  if (kept?.length) result.spec.requiredLabels = kept;
  return result;
}

export function center(rect: Rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

// Character cells are about twice as tall as wide, so vertical distance counts double.
export function autoPorts(from: Rect, to: Rect): [Port, Port] {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = (b.y - a.y) * 2;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

export function inside(outer: Rect, inner: Rect) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

export function containsCell(rect: Rect, [x, y]: Point) {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

export function onPath(path: Point[], [x, y]: Point) {
  for (let i = 1; i < path.length; i++) {
    const [x1, y1] = path[i - 1];
    const [x2, y2] = path[i];
    if (y1 === y2 && y === y1 && x >= Math.min(x1, x2) && x <= Math.max(x1, x2)) return true;
    if (x1 === x2 && x === x1 && y >= Math.min(y1, y2) && y <= Math.max(y1, y2)) return true;
  }
  return false;
}

export function boxAt(g: Geometry, cell: Point) {
  let best = -1;
  for (let i = 0; i < g.boxes.length; i++) {
    const rect = g.boxes[i];
    if (!containsCell(rect, cell)) continue;
    if (best < 0 || rect.width * rect.height < g.boxes[best].width * g.boxes[best].height) best = i;
  }
  return best;
}

export function hitTest(g: Geometry, cell: Point): ElementRef | null {
  for (let i = g.texts.length - 1; i >= 0; i--) if (containsCell(g.texts[i], cell)) return { kind: "text", index: i };
  for (let i = g.icons.length - 1; i >= 0; i--) if (containsCell(g.icons[i], cell)) return { kind: "icon", index: i };
  for (let i = g.arrows.length - 1; i >= 0; i--) if (containsCell(g.arrows[i], cell)) return { kind: "arrow", index: i };
  for (let i = g.connectors.length - 1; i >= 0; i--) if (onPath(g.connectors[i], cell)) return { kind: "connector", index: i };
  for (let i = g.lines.length - 1; i >= 0; i--) if (onPath(g.lines[i], cell)) return { kind: "line", index: i };
  const box = boxAt(g, cell);
  return box >= 0 ? { kind: "box", index: box } : null;
}

export function rectFor(g: Geometry, ref: ElementRef): Rect | null {
  if (ref.kind === "box") return g.boxes[ref.index] ?? null;
  if (ref.kind === "text") return g.texts[ref.index] ?? null;
  if (ref.kind === "icon") return g.icons[ref.index] ?? null;
  if (ref.kind === "arrow") return g.arrows[ref.index] ?? null;
  const path = ref.kind === "connector" ? g.connectors[ref.index] : g.lines[ref.index];
  if (!path) return null;
  const xs = path.map(p => p[0]);
  const ys = path.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
}

type Path = NonNullable<Spec["connectors"]>[number];
type Endpoint = NonNullable<Path["from"]>;
const isPoint = (endpoint: Endpoint | undefined): endpoint is Point => Array.isArray(endpoint);
const refersTo = (endpoint: Endpoint | undefined, id: string) => !!endpoint && !Array.isArray(endpoint) && endpoint.box === id;
function shift(point: Point, dx: number, dy: number): Point { return [point[0] + dx, point[1] + dy]; }

function pathMovable(path: Path) {
  return !!path.points || !!path.via?.length || isPoint(path.from) || isPoint(path.to);
}
function shiftPath(path: Path, dx: number, dy: number) {
  if (path.points) path.points = path.points.map(p => shift(p, dx, dy));
  if (path.via) path.via = path.via.map(p => shift(p, dx, dy));
  if (isPoint(path.from)) path.from = shift(path.from, dx, dy);
  if (isPoint(path.to)) path.to = shift(path.to, dx, dy);
}

export function isMovable(spec: Spec, ref: ElementRef) {
  if (ref.kind === "connector") return pathMovable(spec.connectors![ref.index]);
  if (ref.kind === "line") return pathMovable(spec.lines![ref.index]);
  return true;
}

function refreshAutoPorts(before: Geometry, spec: Spec, moved: Set<string>) {
  const after = geometry(spec);
  for (const path of [...(spec.connectors ?? []), ...(spec.lines ?? [])]) {
    if (path.via?.length || !path.from || !path.to || isPoint(path.from) || isPoint(path.to)) continue;
    if (!moved.has(path.from.box) && !moved.has(path.to.box)) continue;
    const a0 = before.boxById.get(path.from.box);
    const b0 = before.boxById.get(path.to.box);
    const a1 = after.boxById.get(path.from.box);
    const b1 = after.boxById.get(path.to.box);
    if (!a0 || !b0 || !a1 || !b1) continue;
    const [from0, to0] = autoPorts(a0, b0);
    if (path.from.port !== from0 || path.to.port !== to0) continue;
    const [from1, to1] = autoPorts(a1, b1);
    path.from = { ...path.from, port: from1 };
    path.to = { ...path.to, port: to1 };
  }
}

// Moves an element; a box carries everything drawn inside it.
export function translate(origin: Spec, before: Geometry, ref: ElementRef, dx: number, dy: number): Spec {
  const spec = structuredClone(origin);
  const boxes = new Set<number>();
  const texts = new Set<number>();
  const icons = new Set<number>();
  const arrows = new Set<number>();
  const connectors = new Set<number>();
  const lines = new Set<number>();
  if (ref.kind === "box") {
    const container = before.boxes[ref.index];
    boxes.add(ref.index);
    before.boxes.forEach((rect, i) => { if (i !== ref.index && inside(container, rect)) boxes.add(i); });
    before.texts.forEach((rect, i) => { if (inside(container, rect)) texts.add(i); });
    before.icons.forEach((rect, i) => { if (inside(container, rect)) icons.add(i); });
    before.arrows.forEach((rect, i) => { if (inside(container, rect)) arrows.add(i); });
    const pathInside = (path: Point[]) => path.every(p => containsCell(container, p));
    (spec.connectors ?? []).forEach((path, i) => { if (pathMovable(path) && pathInside(before.connectors[i])) connectors.add(i); });
    (spec.lines ?? []).forEach((path, i) => { if (pathMovable(path) && pathInside(before.lines[i])) lines.add(i); });
  } else {
    ({ text: texts, icon: icons, arrow: arrows, connector: connectors, line: lines, box: boxes } as const)[ref.kind].add(ref.index);
  }

  let minX = Infinity;
  let minY = Infinity;
  const consider = (rect: Rect | null) => { if (rect) { minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y); } };
  boxes.forEach(i => consider(before.boxes[i]));
  texts.forEach(i => consider(before.texts[i]));
  icons.forEach(i => consider(before.icons[i]));
  arrows.forEach(i => consider(before.arrows[i]));
  connectors.forEach(i => consider(rectFor(before, { kind: "connector", index: i })));
  lines.forEach(i => consider(rectFor(before, { kind: "line", index: i })));
  dx = Math.max(dx, -minX);
  dy = Math.max(dy, -minY);

  const movedIds = new Set<string>();
  boxes.forEach(i => { const box = spec.boxes![i]; box.x = (box.x ?? 0) + dx; box.y += dy; if (box.id) movedIds.add(box.id); });
  texts.forEach(i => { const text = spec.texts![i]; text.x = (text.x ?? 0) + dx; text.y += dy; });
  icons.forEach(i => { const icon = spec.icons![i]; icon.x += dx; icon.y += dy; });
  arrows.forEach(i => { const arrow = spec.arrows![i]; arrow.x += dx; arrow.y += dy; });
  connectors.forEach(i => shiftPath(spec.connectors![i], dx, dy));
  lines.forEach(i => shiftPath(spec.lines![i], dx, dy));
  if (movedIds.size) {
    try { refreshAutoPorts(before, spec, movedIds); } catch { /* geometry is re-validated by the caller */ }
  }
  return spec;
}

export function removeElement(origin: Spec, ref: ElementRef): Spec {
  const spec = structuredClone(origin);
  if (ref.kind === "box") {
    const id = spec.boxes![ref.index].id;
    spec.boxes!.splice(ref.index, 1);
    if (id) {
      const keep = (path: Path) => !refersTo(path.from, id) && !refersTo(path.to, id);
      spec.connectors = spec.connectors?.filter(keep);
      spec.lines = spec.lines?.filter(keep);
    }
  } else {
    const key = ({ text: "texts", icon: "icons", arrow: "arrows", connector: "connectors", line: "lines" } as const)[ref.kind];
    spec[key]!.splice(ref.index, 1);
  }
  return spec;
}

export function nextBoxId(spec: Spec) {
  const ids = new Set((spec.boxes ?? []).map(box => box.id));
  let n = 1;
  while (ids.has(`box-${n}`)) n++;
  return `box-${n}`;
}

export function friendlyError(error: unknown) {
  const message = (error as Error)?.message ?? String(error);
  if (/Boxes overlap/.test(message)) return "Boxes can’t partly overlap. Put one fully inside the other, or move it clear.";
  if (/Text crosses a line/.test(message)) return "That would draw a line through text.";
  if (/collides with diagram content/.test(message)) return "Icons need empty space. Move it off text and lines.";
  if (/outside the/.test(message)) return "That goes off the canvas.";
  if (/needs at least \d+ columns/.test(message)) return "That icon needs to be wider.";
  if (/wrong direction|clean incoming stem|Cannot create a valid/.test(message)) return "That arrow can’t be routed there. Try another side.";
  if (/Text collision/.test(message)) return "Two labels would overlap.";
  if (/too wide|too tall/.test(message)) return "That text doesn’t fit.";
  if (/16 megapixels|240|140/.test(message)) return "The drawing is too big.";
  return message;
}
