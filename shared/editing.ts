import { displayWidth } from "./engine.js";
import { inside, rectFor, unionRect, type ElementRef, type Geometry, type Point, type Rect } from "./geometry";
import type { Spec } from "./spec";

export type EditKind = "text" | "body" | "title";
export type EditTarget = { kind: EditKind; index: number; origin: Spec };

const chars = (value: string) => [...value];

export function editValue({ kind, index, origin }: EditTarget) {
  if (kind === "text") return origin.texts![index].value;
  const box = origin.boxes![index];
  return kind === "title" ? box.title ?? "" : (box.lines ?? []).join("\n");
}

// Applies in-progress typing to the spec. Extra lines of a text label become labels below it.
export function applyEdit({ kind, index, origin }: EditTarget, raw: string): Spec {
  const value = raw.replace(/\r/g, "").replace(/\t/g, "  ");
  const spec = structuredClone(origin);
  if (kind === "text") {
    const lines = value.split("\n");
    const base = spec.texts![index];
    base.value = lines[0];
    lines.slice(1).forEach((line, k) => spec.texts!.push({ ...base, value: line, y: base.y + k + 1 }));
    return spec;
  }
  const box = spec.boxes![index];
  if (kind === "title") {
    const title = value.replace(/\n/g, " ");
    if (title) box.title = title; else delete box.title;
  } else {
    const lines = value.split("\n");
    if (lines.some(line => line.length)) box.lines = lines; else delete box.lines;
  }
  return spec;
}

export function withoutEmptyTexts(spec: Spec): Spec {
  if (!spec.texts) return spec;
  return { ...spec, texts: spec.texts.filter(text => text.value.trim() !== "") };
}

// Final cleanup once typing ends: drop blank labels and blank leading/trailing body lines.
export function tidyEdit(target: EditTarget, spec: Spec): Spec {
  const next = withoutEmptyTexts(spec);
  if (target.kind === "body") {
    const box = next.boxes![target.index];
    const lines = [...(box.lines ?? [])];
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1)!.trim()) lines.pop();
    if (lines.length) box.lines = lines; else delete box.lines;
  }
  return next;
}

// Where the engine will draw the first character of each line being edited.
export function lineStarts(target: EditTarget, value: string, g: Geometry | null): Point[] {
  const lines = value.split("\n");
  if (target.kind === "text") {
    const text = target.origin.texts![target.index];
    return lines.map((_, i) => [text.x ?? 0, text.y + i]);
  }
  const rect = g?.boxes[target.index];
  if (!rect) return [];
  const box = target.origin.boxes![target.index];
  if (target.kind === "title") {
    const width = displayWidth(lines.join(" "));
    if (!width) return [[rect.x + Math.floor(rect.width / 2), rect.y]];
    const start = box.titleAlign === "left" ? rect.x + 2 : rect.x + Math.floor((rect.width - (width + 2)) / 2);
    return [[start + 1, rect.y]];
  }
  const first = rect.y + 1 + Math.floor((rect.height - 2 - lines.length) / 2);
  return lines.map((line, i) => [
    box.align === "left" ? rect.x + 2 : rect.x + Math.floor((rect.width - displayWidth(line)) / 2),
    first + i,
  ]);
}

// Maps a textarea offset (UTF-16) to a grid cell.
export function caretCell(value: string, offset: number, starts: Point[]): Point | null {
  const before = value.slice(0, offset);
  const line = before.split("\n").length - 1;
  const start = starts[line];
  if (!start) return null;
  const column = chars(before.slice(before.lastIndexOf("\n") + 1)).length;
  return [start[0] + column, start[1]];
}

export function selectionCells(value: string, from: number, to: number, starts: Point[]): Point[] {
  const cells: Point[] = [];
  let line = 0;
  let column = 0;
  let offset = 0;
  for (const char of chars(value)) {
    if (offset >= to) break;
    if (char === "\n") { line++; column = 0; }
    else {
      if (offset >= from && starts[line]) cells.push([starts[line][0] + column, starts[line][1]]);
      column++;
    }
    offset += char.length;
  }
  return cells;
}

export function offsetForColumn(value: string, column: number) {
  return chars(value).slice(0, Math.max(0, column)).join("").length;
}

export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

function rectsExcept(g: Geometry, refs: ElementRef[]): Rect[] {
  const containers = refs.filter(ref => ref.kind === "box").map(ref => g.boxes[ref.index]).filter(Boolean);
  const excluded = (kind: ElementRef["kind"], index: number, rect: Rect) =>
    refs.some(ref => ref.kind === kind && ref.index === index) || containers.some(container => inside(container, rect));
  const pick = (list: Rect[], kind: ElementRef["kind"]) => list.filter((rect, i) => !excluded(kind, i, rect));
  return [...pick(g.boxes, "box"), ...pick(g.texts, "text"), ...pick(g.icons, "icon")];
}

const edges = (start: number, size: number) => [start, start + size / 2, start + size];

// Snaps a move so the selection's outline lines up (left/centre/right, top/middle/bottom) within one cell.
export function snapMove(g: Geometry, refs: ElementRef[], dx: number, dy: number) {
  const rect = unionRect(refs.map(ref => rectFor(g, ref)));
  if (!rect || refs.every(ref => ref.kind === "connector" || ref.kind === "line")) return { dx, dy, guides: [] as Guide[] };
  const others = rectsExcept(g, refs);
  const best = (axis: "x" | "y", delta: number) => {
    const moved = axis === "x" ? edges(rect.x + delta, rect.width) : edges(rect.y + delta, rect.height);
    let snap = 0;
    let distance = Infinity;
    for (const other of others) {
      const targets = axis === "x" ? edges(other.x, other.width) : edges(other.y, other.height);
      for (const a of moved) for (const b of targets) {
        const diff = b - a;
        if (Number.isInteger(diff) && Math.abs(diff) <= 1 && Math.abs(diff) < distance) { distance = Math.abs(diff); snap = diff; }
      }
    }
    return delta + snap;
  };
  const sx = best("x", dx);
  const sy = best("y", dy);
  const moved = { ...rect, x: rect.x + sx, y: rect.y + sy };
  const guides: Guide[] = [];
  for (const other of others) {
    for (const a of edges(moved.x, moved.width)) for (const b of edges(other.x, other.width)) {
      if (a === b) guides.push({ axis: "x", at: a, from: Math.min(moved.y, other.y), to: Math.max(moved.y + moved.height, other.y + other.height) });
    }
    for (const a of edges(moved.y, moved.height)) for (const b of edges(other.y, other.height)) {
      if (a === b) guides.push({ axis: "y", at: a, from: Math.min(moved.x, other.x), to: Math.max(moved.x + moved.width, other.x + other.width) });
    }
  }
  return { dx: sx, dy: sy, guides: guides.slice(0, 8) };
}
