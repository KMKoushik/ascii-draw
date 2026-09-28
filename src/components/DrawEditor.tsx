import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Diagram } from "../../shared/engine.js";
import type { Spec } from "../../shared/spec";
import {
  autoPorts, boxAt, emptySpec, finalize, friendlyError, geometry, hitTest, isEmpty, isMovable, nextBoxId, normalize,
  rectFor, removeElements, requiredBoxSize, translateGroup, duplicateElements, inMarquee, allElements, selectionRect, originShift, shiftSpec,
  type ElementRef, type Geometry, type Point, type Rect,
} from "../../shared/geometry";
import { loadIcon, loadedIcon, measureFont, paintCells, paintIcon } from "../lib/render";
import {
  applyEdit, caretCell, editValue, lineStarts, offsetForColumn, selectionCells, snapMove, tidyEdit, withoutEmptyTexts,
  type EditKind, type EditTarget, type Guide,
} from "../../shared/editing";
import { displayWidth } from "../../shared/engine.js";
import { Inspector } from "./Inspector";

export type Tool = "select" | "hand" | "box" | "arrow" | "text" | "icon";
export const palette = ["#e8e8e5", "#79bdff", "#ffd15b", "#b7e3a1", "#ff9d91", "#c4a7ff", "#7fdbca", "#929da7"];

const tools: { id: Tool; label: string; key: string; glyph: string; hint: string }[] = [
  { id: "select", label: "Select", key: "V", glyph: "↖", hint: "Drag empty space to select many. Double-click to write. Scroll or Space-drag to pan, pinch to zoom." },
  { id: "hand", label: "Hand", key: "H", glyph: "✥", hint: "Drag to move around. Scroll, or hold Space and drag, from any tool." },
  { id: "box", label: "Box", key: "R", glyph: "▭", hint: "Drag to draw a box, then type its title." },
  { id: "arrow", label: "Arrow", key: "A", glyph: "→", hint: "Drag from one box to another." },
  { id: "text", label: "Text", key: "T", glyph: "T", hint: "Click anywhere and type. Click in a box to write inside it." },
  { id: "icon", label: "Icon", key: "I", glyph: "◇", hint: "Click to place an icon." },
];
const toolKeys: Record<string, Tool> = { v: "select", h: "hand", r: "box", a: "arrow", t: "text", i: "icon", "1": "select", "2": "box", "3": "arrow", "4": "text", "5": "icon" };
const baseSize = 16;
const zoomSteps = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];
const minZoom = zoomSteps[0];
const maxZoom = zoomSteps.at(-1)!;
// Where grid cell 0,0 sits on screen before any panning: clear of the floating toolbar.
const homeCamera = { x: -16, y: -60 };
const clampZoom = (value: number) => Math.min(maxZoom, Math.max(minZoom, value));
const emptyDiagram: Diagram = { text: "", cells: [], pngCells: [], icons: [] };

type Handle = "nw" | "ne" | "sw" | "se";
// shift: how far a preview moved content to keep coordinates non-negative (drawn back in place).
type View = { spec: Spec; diagram: Diagram; shift?: Point };
type Camera = { x: number; y: number };
type Drag =
  | { type: "move"; start: Point; origin: Spec; before: Geometry; refs: ElementRef[]; clicked: ElementRef; narrow: boolean; candidate?: Spec }
  | { type: "marquee"; start: Point; current: Point; base: ElementRef[] }
  | { type: "pan"; startX: number; startY: number; camera: Camera }
  | { type: "resize"; start: Point; origin: Spec; before: Geometry; ref: ElementRef; handle: Handle; candidate?: Spec }
  | { type: "box"; start: Point; current: Point }
  | { type: "arrow"; start: Point; startBox: number; current: Point; candidate?: Spec };
type Ghost = { rect?: Rect; path?: Point[]; invalid?: boolean; marquee?: boolean };
type Path = NonNullable<Spec["connectors"]>[number];
type Editing = EditTarget & { value: string; start: number; end: number; invalid: boolean; id: number };

type Props = {
  spec: Spec | null;
  diagram: Diagram | null;
  onCommit: (spec: Spec | null, mergeKey?: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

const sameRef = (a: ElementRef | null, b: ElementRef | null) => !!a && !!b && a.kind === b.kind && a.index === b.index;
const between = (a: Point, b: Point): Rect => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]) + 1, height: Math.abs(a[1] - b[1]) + 1 });
const cellRect = ([x, y]: Point): Rect => ({ x, y, width: 1, height: 1 });

function pathCells(path: Point[]) {
  const cells: Point[] = [];
  for (let i = 1; i < path.length; i++) {
    const [x1, y1] = path[i - 1];
    const [x2, y2] = path[i];
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let s = 0; s <= steps; s++) cells.push([x1 + Math.sign(x2 - x1) * s, y1 + Math.sign(y2 - y1) * s]);
  }
  return cells;
}

export function DrawEditor({ spec: specProp, diagram: diagramProp, onCommit, onUndo, onRedo, canUndo, canRedo }: Props) {
  const base: View = useMemo(() => ({ spec: specProp ?? emptySpec, diagram: diagramProp ?? emptyDiagram }), [specProp, diagramProp]);
  const doc = useMemo(() => normalize(base.spec), [base.spec]);
  const docGeometry = useMemo(() => { try { return geometry(doc); } catch { return null; } }, [doc]);

  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(palette[1]);
  const [selected, setSelected] = useState<ElementRef[]>([]);
  // A single selection gets the inspector, resize handles, and text editing.
  const selection = selected.length === 1 ? selected[0] : null;
  const setSelection = useCallback((ref: ElementRef | null) => setSelected(ref ? [ref] : []), []);
  const [hover, setHover] = useState<ElementRef | null>(null);
  const [preview, setPreview] = useState<View | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState("");
  const [fontReady, setFontReady] = useState(false);
  const [iconTick, setIconTick] = useState(0);
  const [cursor, setCursor] = useState("default");
  const [focusField, setFocusField] = useState<string | null>(null);
  const [lastIcon, setLastIcon] = useState("outline/server");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [caretOn, setCaretOn] = useState(true);
  const [guides, setGuides] = useState<Guide[]>([]);
  const editingRef = useRef<Editing | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editSeq = useRef(0);
  const drag = useRef<Drag | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  // The canvas is a viewport over an unbounded grid; the camera is the doc-pixel offset of its top-left.
  const [camera, setCamera] = useState<Camera>(homeCamera);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const spaceRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const measureContext = useRef<CanvasRenderingContext2D | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const view = preview ?? base;
  const viewGeometry = useMemo(() => {
    if (!preview) return docGeometry;
    try { return geometry(normalize(preview.spec)); } catch { return null; }
  }, [preview, docGeometry]);

  useEffect(() => { void document.fonts.load(`${baseSize}px "JetBrains Mono"`).then(() => setFontReady(true)); }, []);
  const measureAt = useCallback((level: number) => {
    measureContext.current ??= document.createElement("canvas").getContext("2d")!;
    return measureFont(measureContext.current, baseSize * level, Math.round(2 * level));
  }, []);
  // fontReady re-measures once JetBrains Mono has loaded.
  const metrics = useMemo(() => measureAt(zoom), [zoom, fontReady, measureAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const [area, setArea] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setArea({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Keep the visible grid still when content shifts to stay at non-negative coordinates.
  const moveCamera = useCallback(([dx, dy]: Point) => {
    if (!dx && !dy) return;
    const { cellWidth, advance } = metricsRef.current;
    setCamera(current => ({ x: current.x + dx * cellWidth, y: current.y + dy * advance }));
  }, []);

  // Zooms so the grid point under `anchor` (canvas pixels) stays put.
  const zoomAt = useCallback((level: number, anchor?: Point) => {
    const next = clampZoom(level);
    const before = metricsRef.current;
    const after = measureAt(next);
    const [ax, ay] = anchor ?? [areaRef.current!.clientWidth / 2, areaRef.current!.clientHeight / 2];
    setCamera(current => ({
      x: ((ax + current.x) / before.cellWidth) * after.cellWidth - ax,
      y: ((ay + current.y) / before.advance) * after.advance - ay,
    }));
    setZoom(next);
  }, [measureAt]);

  useEffect(() => {
    if (!docGeometry) return;
    setSelected(current => {
      const kept = current.filter(ref => rectFor(docGeometry, ref));
      return kept.length === current.length ? current : kept;
    });
  }, [docGeometry]);

  const flash = useCallback((text: string) => {
    setMessage(text);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(""), 3200);
  }, []);
  useEffect(() => () => clearTimeout(messageTimer.current), []);

  const commit = useCallback((next: Spec, mergeKey?: string) => {
    if (isEmpty(next)) { onCommit(null, mergeKey); return true; }
    try {
      const result = finalize(next);
      moveCamera(result.shift);
      onCommit(result.spec, mergeKey);
      return true;
    } catch (error) {
      flash(friendlyError(error));
      return false;
    }
  }, [onCommit, flash, moveCamera]);

  // New content left of or above the origin: shift the drawing first (and the camera with it)
  // so edits in progress always use valid coordinates.
  function atOrigin(spec: Spec) {
    const shift = originShift(spec);
    moveCamera(shift);
    return shiftSpec(spec, shift[0], shift[1]);
  }

  const tryView = (next: Spec): View | null => attempt(next).view;
  function attempt(next: Spec): { view: View | null; error?: string } {
    if (isEmpty(next)) return { view: { spec: emptySpec, diagram: emptyDiagram } };
    try { return { view: finalize(next) }; } catch (error) { return { view: null, error: friendlyError(error) }; }
  }

  function startEdit(target: EditTarget, caret?: number) {
    const value = editValue(target);
    const offset = caret ?? value.length;
    const next: Editing = { ...target, value, start: offset, end: offset, invalid: false, id: ++editSeq.current };
    editingRef.current = next;
    setEditing(next);
    // Focus synchronously so keys typed straight after a double-click land in the editor.
    const element = editorRef.current;
    if (element) {
      element.value = value;
      element.focus({ preventScroll: true });
      element.setSelectionRange(offset, offset);
    }
    setSelection(target.kind === "text" ? null : { kind: "box", index: target.index });
    setHover(null);
    setTool("select");
    setPreview(attempt(withoutEmptyTexts(applyEdit(next, value))).view);
  }

  function updateEdit(value: string, start: number, end: number) {
    const current = editingRef.current;
    if (!current) return;
    const { view, error } = attempt(withoutEmptyTexts(applyEdit(current, value)));
    const next = { ...current, value, start, end, invalid: !view };
    editingRef.current = next;
    setEditing(next);
    setCaretOn(true);
    if (view) setPreview(view);
    else if (error) flash(error);
  }

  function finishEdit() {
    const current = editingRef.current;
    if (!current) return;
    editingRef.current = null;
    setEditing(null);
    setPreview(null);
    const spec = tidyEdit(current, applyEdit(current, current.value));
    if (JSON.stringify(normalize(spec)) === JSON.stringify(doc)) return;
    if (!commit(spec)) return;
    if (current.kind === "text") {
      const base = current.origin.texts![current.index];
      const index = (spec.texts ?? []).findIndex(text => text.x === base.x && text.y === base.y);
      setSelection(index >= 0 ? { kind: "text", index } : null);
    } else {
      setSelection({ kind: "box", index: current.index });
    }
  }

  function switchEdit(kind: EditKind) {
    const current = editingRef.current;
    if (!current || current.kind === "text" || current.kind === kind) return;
    startEdit({ kind, index: current.index, origin: tidyEdit(current, applyEdit(current, current.value)) });
  }

  // Clicking text edits it; clicking a box writes in it (top border = title); anywhere else starts a new label.
  function editAt(cell: Point) {
    if (!docGeometry) return;
    const hit = hitTest(docGeometry, cell);
    if (hit?.kind === "text") {
      const text = doc.texts![hit.index];
      startEdit({ kind: "text", index: hit.index, origin: doc }, offsetForColumn(text.value, cell[0] - (text.x ?? 0)));
      return;
    }
    const box = boxAt(docGeometry, cell);
    if (box >= 0) {
      startEdit({ kind: cell[1] === docGeometry.boxes[box].y ? "title" : "body", index: box, origin: doc });
      return;
    }
    const draft = structuredClone(doc);
    draft.texts = [...(draft.texts ?? []), { x: cell[0], y: cell[1], value: "", color }];
    const origin = atOrigin(draft);
    startEdit({ kind: "text", index: origin.texts!.length - 1, origin }, 0);
  }

  useLayoutEffect(() => {
    const element = editorRef.current;
    if (!editing || !element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(editing.start, editing.end);
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editing) return;
    setCaretOn(true);
    const timer = setInterval(() => setCaretOn(on => !on), 530);
    return () => clearInterval(timer);
  }, [editing?.id, editing?.value, editing?.start]); // eslint-disable-line react-hooks/exhaustive-deps

  // Paint: grid, the engine's cells and icons, then selection overlays.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { cellWidth: cw, advance: ah } = metrics;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, area.width);
    const height = Math.max(1, area.height);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const context = canvas.getContext("2d")!;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = view.spec.style?.background ?? "#000000";
    context.fillRect(0, 0, width, height);

    // Grid coordinates are drawn through the camera. Doc overlays (ghosts, guides) use the
    // document's coordinates; the rendered view may be a preview shifted by `view.shift`.
    const [sx, sy] = view.shift ?? [0, 0];
    const docSpace = () => context.setTransform(dpr, 0, 0, dpr, -camera.x * dpr, -camera.y * dpr);
    const viewSpace = () => context.setTransform(dpr, 0, 0, dpr, (-camera.x - sx * cw) * dpr, (-camera.y - sy * ah) * dpr);

    docSpace();
    {
      // Thin the dots when zoomed out so they stay about 8px apart.
      const strideX = Math.max(1, Math.ceil(8 / cw));
      const strideY = Math.max(1, Math.ceil(8 / ah));
      context.fillStyle = "#1c252c";
      const c0 = Math.floor(camera.x / cw / strideX) * strideX, c1 = Math.ceil((camera.x + width) / cw);
      const r0 = Math.floor(camera.y / ah / strideY) * strideY, r1 = Math.ceil((camera.y + height) / ah);
      for (let r = r0; r <= r1; r += strideY) for (let c = c0; c <= c1; c += strideX) context.fillRect(Math.round(c * cw), Math.round(r * ah), 1, 1);
    }

    viewSpace();
    const range = {
      fromCol: Math.floor(camera.x / cw) + sx - 1, toCol: Math.ceil((camera.x + width) / cw) + sx + 1,
      fromRow: Math.floor(camera.y / ah) + sy - 1, toRow: Math.ceil((camera.y + height) / ah) + sy + 1,
    };
    paintCells(context, view.diagram.pngCells, metrics, 0, 0, view.spec.style?.foreground ?? "#f2f2f2", range);
    for (const icon of view.diagram.icons) {
      const image = loadedIcon(icon.id, icon.color);
      if (image) paintIcon(context, image, icon, metrics, 0, 0);
      else loadIcon(icon.id, icon.color).then(() => setIconTick(tick => tick + 1)).catch(() => {});
    }

    const box = (rect: Rect, stroke: string, dash: number[] = [], lineWidth = 1) => {
      context.save();
      context.strokeStyle = stroke;
      context.lineWidth = lineWidth;
      context.setLineDash(dash);
      context.strokeRect(rect.x * cw - 2.5, rect.y * ah - 2.5, rect.width * cw + 5, rect.height * ah + 5);
      context.restore();
    };
    const fillPath = (path: Point[], fill: string) => {
      context.fillStyle = fill;
      for (const [x, y] of pathCells(path)) context.fillRect(x * cw, y * ah, cw, ah);
    };
    const g = viewGeometry;
    if (g && hover && !drag.current && !selected.some(ref => sameRef(ref, hover))) {
      const rect = rectFor(g, hover);
      if (hover.kind === "connector" || hover.kind === "line") fillPath((hover.kind === "connector" ? g.connectors : g.lines)[hover.index], "rgba(121, 189, 255, 0.10)");
      else if (rect) box(rect, "rgba(121, 189, 255, 0.35)");
    }
    if (g && selected.length > 1 && !editing) {
      for (const ref of selected) {
        if (ref.kind === "connector" || ref.kind === "line") fillPath((ref.kind === "connector" ? g.connectors : g.lines)[ref.index] ?? [], "rgba(121, 189, 255, 0.22)");
        else { const rect = rectFor(g, ref); if (rect) box(rect, "rgba(121, 189, 255, 0.8)", [2, 3]); }
      }
      const group = selectionRect(g, selected);
      if (group) box({ x: group.x - 0.5, y: group.y - 0.25, width: group.width + 1, height: group.height + 0.5 }, "#79bdff", [6, 4]);
    }
    if (g && selection && !editing) {
      const rect = rectFor(g, selection);
      if (selection.kind === "connector" || selection.kind === "line") {
        fillPath((selection.kind === "connector" ? g.connectors : g.lines)[selection.index], "rgba(121, 189, 255, 0.22)");
      } else if (rect) {
        box(rect, "#79bdff", [4, 3]);
        const handles: Handle[] = selection.kind === "box" ? ["nw", "ne", "sw", "se"] : selection.kind === "icon" ? ["se"] : [];
        for (const handle of handles) {
          const [hx, hy] = handlePoint(rect, handle);
          context.fillStyle = "#000000";
          context.fillRect(hx - 4, hy - 4, 8, 8);
          context.strokeStyle = "#79bdff";
          context.lineWidth = 1;
          context.setLineDash([]);
          context.strokeRect(hx - 3.5, hy - 3.5, 7, 7);
        }
      }
    }
    docSpace();
    if (ghost?.rect && ghost.marquee) {
      context.fillStyle = "rgba(121, 189, 255, 0.08)";
      context.fillRect(ghost.rect.x * cw, ghost.rect.y * ah, ghost.rect.width * cw, ghost.rect.height * ah);
      box(ghost.rect, "rgba(121, 189, 255, 0.7)", [3, 3]);
    } else if (ghost?.rect) box(ghost.rect, ghost.invalid ? "#ff9d91" : "#79bdff", [4, 3]);
    if (ghost?.path) fillPath(ghost.path, ghost.invalid ? "rgba(255, 157, 145, 0.25)" : "rgba(121, 189, 255, 0.2)");

    viewSpace();
    if (editing && g) {
      const starts = lineStarts(editing, editing.value, g);
      if (editing.kind === "text" && starts.length) {
        const lines = editing.value.split("\n");
        box({ x: starts[0][0], y: starts[0][1], width: Math.max(1, ...lines.map(displayWidth)) + 1, height: lines.length }, "rgba(121, 189, 255, 0.45)", [2, 3]);
      } else if (g.boxes[editing.index]) {
        box(g.boxes[editing.index], "#79bdff", [4, 3]);
      }
      context.fillStyle = "rgba(121, 189, 255, 0.35)";
      for (const [x, y] of selectionCells(editing.value, editing.start, editing.end, starts)) context.fillRect(x * cw, y * ah, cw, ah);
      const caret = caretCell(editing.value, editing.end, starts);
      if (caret && caretOn && editing.start === editing.end) {
        context.fillStyle = editing.invalid ? "#ff9d91" : "#79bdff";
        context.fillRect(caret[0] * cw, caret[1] * ah + ah * 0.12, Math.max(2, cw * 0.14), ah * 0.76);
      }
    }

    docSpace();
    if (guides.length) {
      context.save();
      context.strokeStyle = "#ff9d91";
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      for (const guide of guides) {
        if (guide.axis === "x") { context.moveTo(Math.round(guide.at * cw) + 0.5, guide.from * ah - 6); context.lineTo(Math.round(guide.at * cw) + 0.5, guide.to * ah + 6); }
        else { context.moveTo(guide.from * cw - 6, Math.round(guide.at * ah) + 0.5); context.lineTo(guide.to * cw + 6, Math.round(guide.at * ah) + 0.5); }
      }
      context.stroke();
      context.restore();
    }

    function handlePoint(rect: Rect, handle: Handle): Point {
      const left = rect.x * cw - 2.5;
      const top = rect.y * ah - 2.5;
      const right = (rect.x + rect.width) * cw + 2.5;
      const bottom = (rect.y + rect.height) * ah + 2.5;
      return [handle.includes("w") ? left : right, handle.includes("n") ? top : bottom];
    }
  }, [view, viewGeometry, metrics, area, camera, hover, selected, selection, ghost, iconTick, editing, caretOn, guides]);

  function pointer(event: React.PointerEvent | React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = event.clientX - rect.left + cameraRef.current.x;
    const y = event.clientY - rect.top + cameraRef.current.y;
    const cell: Point = [Math.floor(x / metrics.cellWidth), Math.floor(y / metrics.advance)];
    return { cell, x, y };
  }

  function handleAt(x: number, y: number): Handle | null {
    if (!selection || !docGeometry || (selection.kind !== "box" && selection.kind !== "icon")) return null;
    const rect = rectFor(docGeometry, selection);
    if (!rect) return null;
    const { cellWidth: cw, advance: ah } = metrics;
    const handles: Handle[] = selection.kind === "box" ? ["nw", "ne", "sw", "se"] : ["se"];
    for (const handle of handles) {
      const hx = handle.includes("w") ? rect.x * cw - 2.5 : (rect.x + rect.width) * cw + 2.5;
      const hy = handle.includes("n") ? rect.y * ah - 2.5 : (rect.y + rect.height) * ah + 2.5;
      if (Math.abs(x - hx) <= 8 && Math.abs(y - hy) <= 8) return handle;
    }
    return null;
  }

  function resized(d: Extract<Drag, { type: "resize" }>, cell: Point): Spec {
    const next = structuredClone(d.origin);
    const dx = cell[0] - d.start[0];
    const dy = cell[1] - d.start[1];
    const rect = rectFor(d.before, d.ref)!;
    if (d.ref.kind === "icon") {
      const icon = next.icons![d.ref.index];
      icon.width = Math.max(2, rect.width + dx);
      icon.height = Math.max(1, rect.height + dy);
      return next;
    }
    const target = next.boxes![d.ref.index];
    const min = requiredBoxSize(target);
    const width = Math.max(min.width, d.handle.includes("w") ? rect.width - dx : rect.width + dx);
    const height = Math.max(min.height, d.handle.includes("n") ? rect.height - dy : rect.height + dy);
    target.x = d.handle.includes("w") ? rect.x + rect.width - width : rect.x;
    target.y = d.handle.includes("n") ? rect.y + rect.height - height : rect.y;
    target.width = width;
    target.height = height;
    return next;
  }

  function arrowSpec(d: Extract<Drag, { type: "arrow" }>): Spec | null {
    if (!docGeometry) return null;
    const g = docGeometry;
    const endBox = boxAt(g, d.current);
    const same = d.start[0] === d.current[0] && d.start[1] === d.current[1];
    if ((d.startBox >= 0 && endBox === d.startBox) || (d.startBox < 0 && endBox < 0 && same)) return null;
    const next = structuredClone(doc);
    const id = (i: number) => next.boxes![i].id!;
    const connector: Path = { color };
    if (d.startBox >= 0 && endBox >= 0) {
      const [from, to] = autoPorts(g.boxes[d.startBox], g.boxes[endBox]);
      connector.from = { box: id(d.startBox), port: from };
      connector.to = { box: id(endBox), port: to };
    } else if (d.startBox >= 0) {
      connector.from = { box: id(d.startBox), port: autoPorts(g.boxes[d.startBox], cellRect(d.current))[0] };
      connector.to = d.current;
    } else if (endBox >= 0) {
      connector.from = d.start;
      connector.to = { box: id(endBox), port: autoPorts(cellRect(d.start), g.boxes[endBox])[1] };
    } else {
      const [sx, sy] = d.start;
      const [ex, ey] = d.current;
      connector.points = sx === ex || sy === ey ? [d.start, d.current] : [d.start, [ex, sy], d.current];
    }
    next.connectors = [...(next.connectors ?? []), connector];
    return next;
  }

  function candidateRect(d: Extract<Drag, { type: "move" | "resize" }>, cell: Point, dx: number, dy: number): Rect | null {
    if (d.type === "move") {
      const rect = selectionRect(d.before, d.refs);
      return rect && { ...rect, x: rect.x + dx, y: rect.y + dy };
    }
    const rect = rectFor(d.before, d.ref);
    if (!rect) return null;
    try { return rectFor(geometry(normalize(resized(d, cell))), d.ref); } catch { return rect; }
  }

  function place(next: Spec, select: ElementRef, field: string | null) {
    if (commit(next)) {
      setSelection(select);
      setFocusField(field);
    }
    setTool("select");
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    // Middle button, the Hand tool, or holding Space pans the canvas.
    if (event.button === 1 || (event.button === 0 && (tool === "hand" || spaceRef.current))) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { type: "pan", startX: event.clientX, startY: event.clientY, camera: cameraRef.current };
      setCursor("grabbing");
      return;
    }
    if (event.button !== 0 || !docGeometry) return;
    event.preventDefault();
    if (editingRef.current) { finishEdit(); event.currentTarget.focus({ preventScroll: true }); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    const { cell, x, y } = pointer(event);
    if (tool === "select") {
      const handle = handleAt(x, y);
      if (handle && selection) {
        drag.current = { type: "resize", start: cell, origin: doc, before: docGeometry, ref: selection, handle };
        return;
      }
      const hit = hitTest(docGeometry, cell);
      setFocusField(null);
      if (!hit) {
        const base = event.shiftKey ? selected : [];
        if (!event.shiftKey) setSelected([]);
        drag.current = { type: "marquee", start: cell, current: cell, base };
        return;
      }
      const chosen = selected.some(ref => sameRef(ref, hit));
      if (event.shiftKey) {
        setSelected(chosen ? selected.filter(ref => !sameRef(ref, hit)) : [...selected, hit]);
        return;
      }
      const refs = chosen ? selected : [hit];
      if (!chosen) setSelected([hit]);
      const movable = refs.filter(ref => isMovable(doc, ref));
      if (movable.length) drag.current = { type: "move", start: cell, origin: doc, before: docGeometry, refs: movable, clicked: hit, narrow: chosen && refs.length > 1 };
      return;
    }
    if (tool === "box") {
      drag.current = { type: "box", start: cell, current: cell };
      setGhost({ rect: between(cell, cell) });
      return;
    }
    if (tool === "arrow") {
      drag.current = { type: "arrow", start: cell, startBox: boxAt(docGeometry, cell), current: cell };
      return;
    }
    if (tool === "text") { editAt(cell); return; }
    const next = structuredClone(doc);
    next.icons = [...(next.icons ?? []), { id: lastIcon, x: cell[0], y: cell[1], width: 4, height: 3, color }];
    place(next, { kind: "icon", index: next.icons.length - 1 }, "icon");
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (d?.type === "pan") {
      setCamera({ x: d.camera.x - (event.clientX - d.startX), y: d.camera.y - (event.clientY - d.startY) });
      return;
    }
    if (!docGeometry) return;
    const { cell, x, y } = pointer(event);
    if (!d) {
      if (tool === "hand" || spaceRef.current) { setCursor("grab"); setHover(null); return; }
      if (tool !== "select") { setCursor("crosshair"); setHover(null); return; }
      const handle = handleAt(x, y);
      if (handle) { setCursor(handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize"); return; }
      const hit = hitTest(docGeometry, cell);
      setHover(hit);
      setCursor(hit ? (isMovable(doc, hit) ? "move" : "pointer") : "default");
      return;
    }
    if (d.type === "box") {
      d.current = cell;
      setGhost({ rect: between(d.start, cell) });
      return;
    }
    if (d.type === "marquee") {
      d.current = cell;
      const rect = between(d.start, cell);
      setGhost({ rect, marquee: true });
      const found = inMarquee(docGeometry, rect).filter(ref => !d.base.some(other => sameRef(other, ref)));
      setSelected([...d.base, ...found]);
      return;
    }
    if (d.type === "arrow") {
      d.current = cell;
      const next = arrowSpec(d);
      const result = next && tryView(next);
      d.candidate = result ? next! : undefined;
      if (result) { setPreview(result); setGhost(null); }
      else { setPreview(null); setGhost({ path: [d.start, [cell[0], d.start[1]], cell], invalid: !!next }); }
      return;
    }
    if (d.type === "move" && cell[0] === d.start[0] && cell[1] === d.start[1]) {
      d.candidate = undefined;
      setPreview(null);
      setGhost(null);
      setGuides([]);
      return;
    }
    let dx = cell[0] - d.start[0];
    let dy = cell[1] - d.start[1];
    if (d.type === "move" && !event.altKey) {
      const snapped = snapMove(d.before, d.refs, dx, dy);
      dx = snapped.dx;
      dy = snapped.dy;
      setGuides(snapped.guides);
    } else {
      setGuides([]);
    }
    const next = d.type === "move" ? translateGroup(d.origin, d.before, d.refs, dx, dy) : resized(d, cell);
    d.candidate = next;
    const result = tryView(next);
    if (result) { setPreview(result); setGhost(null); }
    else { setPreview(null); setGhost({ rect: candidateRect(d, cell, dx, dy) ?? undefined, invalid: true }); }
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    setPreview(null);
    setGhost(null);
    setGuides([]);
    if (!d) return;
    if (d.type === "pan") { setCursor(tool === "hand" || spaceRef.current ? "grab" : "default"); return; }
    if (d.type === "marquee") return;
    if (d.type === "move" && !d.candidate) {
      // A plain click on one member of a group narrows the selection to it.
      if (d.narrow) setSelected([d.clicked]);
      return;
    }
    if (d.type === "move" || d.type === "resize") {
      if (d.candidate) commit(d.candidate);
      return;
    }
    if (d.type === "arrow") {
      const next = arrowSpec(d);
      if (!next) { flash("Drag from a box, or across empty space, to draw an arrow."); return; }
      const key = next.connectors!.length - 1;
      if (commit(next)) { setSelection({ kind: "connector", index: key }); setTool("select"); }
      return;
    }
    let rect = between(d.start, d.current);
    if (rect.width < 4 || rect.height < 3) rect = { x: d.start[0], y: d.start[1], width: 20, height: 5 };
    const next = structuredClone(doc);
    next.boxes = [...(next.boxes ?? []), { id: nextBoxId(doc), ...rect, color }];
    const check = attempt(next);
    if (!check.view) { flash(check.error ?? "That box doesn’t fit there."); return; }
    startEdit({ kind: "title", index: next.boxes.length - 1, origin: normalize(atOrigin(next)) });
  }

  function onPointerCancel() {
    drag.current = null;
    setPreview(null);
    setGhost(null);
  }

  function onDoubleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (tool !== "select" || !docGeometry) return;
    const { cell } = pointer(event);
    const hit = hitTest(docGeometry, cell);
    if (hit?.kind === "icon") { setSelection(hit); setFocusField("icon"); return; }
    if (hit?.kind === "connector" || hit?.kind === "line" || hit?.kind === "arrow") return;
    editAt(cell);
  }

  const remove = useCallback(() => {
    if (!selected.length) return;
    if (commit(removeElements(doc, selected))) setSelected([]);
  }, [selected, doc, commit]);

  const recolor = (value: string) => {
    setColor(value);
    if (!selected.length) return;
    const next = structuredClone(doc);
    for (const { kind, index } of selected) {
      if (kind === "box") next.boxes![index].color = value;
      if (kind === "text") next.texts![index].color = value;
      if (kind === "icon") next.icons![index].color = value;
      if (kind === "arrow") next.arrows![index].color = value;
      if (kind === "connector") { next.connectors![index].color = value; delete next.connectors![index].arrowColor; }
      if (kind === "line") next.lines![index].color = value;
    }
    commit(next, `${selected.map(ref => `${ref.kind}:${ref.index}`).join(",")}:color`);
  };

  const duplicate = useCallback(() => {
    if (!selected.length || !docGeometry) return;
    const { spec: next, refs } = duplicateElements(doc, docGeometry, selected);
    if (refs.length && commit(next)) setSelected(refs);
  }, [selected, doc, docGeometry, commit]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest?.("input, textarea, select, [contenteditable]")) {
        if (event.key === "Escape") target.blur();
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (target === canvasRef.current && [" ", "Home", "End", "PageUp", "PageDown"].includes(event.key)) event.preventDefault();
      if (event.key === " ") {
        event.preventDefault();
        if (!spaceRef.current) { spaceRef.current = true; setSpaceHeld(true); if (!drag.current) setCursor("grab"); }
        return;
      }
      if (event.shiftKey && event.code === "Digit1" && !mod) { event.preventDefault(); fit(); return; }
      if (event.shiftKey && event.code === "Digit0" && !mod) { event.preventDefault(); zoomAt(1); return; }
      if (mod && (event.key === "=" || event.key === "+")) { event.preventDefault(); zoomBy(1); return; }
      if (mod && event.key === "-") { event.preventDefault(); zoomBy(-1); return; }
      if (mod && event.key === "0") { event.preventDefault(); zoomAt(1); return; }
      if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) onRedo(); else onUndo(); return; }
      if (mod && key === "y") { event.preventDefault(); onRedo(); return; }
      if (mod && key === "d") { event.preventDefault(); duplicate(); return; }
      if (mod && key === "a" && docGeometry) { event.preventDefault(); setTool("select"); setSelected(allElements(docGeometry)); return; }
      if (mod || event.altKey) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selected.length) { event.preventDefault(); remove(); return; }
      if (event.key === "Escape") { setSelected([]); setTool("select"); onPointerCancel(); return; }
      if (event.key === "Enter" && selection) {
        event.preventDefault();
        if (selection.kind === "box") startEdit({ kind: "title", index: selection.index, origin: doc });
        else if (selection.kind === "text") startEdit({ kind: "text", index: selection.index, origin: doc });
        else if (selection.kind === "icon") setFocusField("icon");
        return;
      }
      const nudges: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const movable = selected.filter(ref => isMovable(doc, ref));
      if (nudges[event.key] && movable.length && docGeometry) {
        event.preventDefault();
        const step = event.shiftKey ? 5 : 1;
        commit(translateGroup(doc, docGeometry, movable, nudges[event.key][0] * step, nudges[event.key][1] * step), `${movable.map(ref => `${ref.kind}:${ref.index}`).join(",")}:nudge`);
        return;
      }
      if (toolKeys[key]) { setTool(toolKeys[key]); if (toolKeys[key] !== "select") setSelection(null); }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== " " || !spaceRef.current) return;
      spaceRef.current = false;
      setSpaceHeld(false);
      if (drag.current?.type !== "pan") setCursor("default");
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [selected, selection, doc, docGeometry, commit, remove, duplicate, onUndo, onRedo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scrolling pans (Shift for sideways on a mouse wheel); pinch or ⌘/Ctrl+scroll zooms at the cursor.
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        const rect = element!.getBoundingClientRect();
        zoomAt(zoomRef.current * Math.exp(-event.deltaY * unit * 0.0075), [event.clientX - rect.left, event.clientY - rect.top]);
        return;
      }
      const sideways = event.shiftKey && !event.deltaX;
      const dx = (sideways ? event.deltaY : event.deltaX) * unit;
      const dy = (sideways ? 0 : event.deltaY) * unit;
      setCamera(current => ({ x: current.x + dx, y: current.y + dy }));
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Frames the whole drawing (Shift+1).
  function fit() {
    const width = areaRef.current?.clientWidth || area.width;
    const height = areaRef.current?.clientHeight || area.height;
    const bounds = docGeometry && !isEmpty(doc) ? selectionRect(docGeometry, allElements(docGeometry)) : null;
    if (!bounds || !width || !height) { setZoom(1); setCamera(homeCamera); return; }
    const unit = measureAt(1);
    const level = clampZoom(Math.min(2, (width - 64) / (bounds.width * unit.cellWidth), (height - 160) / (bounds.height * unit.advance)));
    const scaled = measureAt(level);
    setZoom(level);
    setCamera({
      x: (bounds.x + bounds.width / 2) * scaled.cellWidth - width / 2,
      y: (bounds.y + bounds.height / 2) * scaled.advance - height / 2 - 20,
    });
  }

  // The hidden input covers the text being edited, so the browser never needs to scroll
  // anything to keep its caret in view. It is fixed to the viewport and portalled to <body>.
  const editorStyle = useMemo<React.CSSProperties>(() => {
    if (!editing) return { left: 0, top: 0, width: 1, height: 1 };
    const starts = lineStarts(editing, editing.value, viewGeometry);
    const bounds = canvasRef.current?.getBoundingClientRect();
    const left = Math.min(...starts.map(start => start[0]));
    const top = starts[0]?.[1] ?? 0;
    const lines = Math.max(1, editing.value.split("\n").length);
    return {
      left: (bounds?.left ?? 0) - camera.x + left * metrics.cellWidth,
      top: (bounds?.top ?? 0) - camera.y + top * metrics.advance,
      width: Math.max(area.width, 400) * 2,
      height: (lines + 1) * metrics.advance,
      fontSize: metrics.size,
      lineHeight: `${metrics.advance}px`,
    };
  }, [editing, viewGeometry, metrics, camera, area]);
  function zoomBy(direction: number) {
    const current = zoomRef.current;
    const next = direction > 0 ? zoomSteps.find(step => step > current + 0.001) : [...zoomSteps].reverse().find(step => step < current - 0.001);
    zoomAt(next ?? current);
  }
  const active = tools.find(item => item.id === tool)!;
  const onFocused = useCallback(() => setFocusField(null), []);

  return <div ref={areaRef} className="draw-area">
      <canvas
        ref={canvasRef}
        className="draw-canvas"
        tabIndex={0}
        aria-label="Drawing canvas"
        data-cell-width={metrics.cellWidth}
        data-row-height={metrics.advance}
        data-origin-x={-camera.x}
        data-origin-y={-camera.y}
        style={{ cursor: spaceHeld && !drag.current ? "grab" : cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => { if (!drag.current) setHover(null); }}
        onDoubleClick={onDoubleClick}
      />
      {createPortal(<textarea
        ref={editorRef}
        className="draw-input"
        tabIndex={editing ? 0 : -1}
        aria-hidden={!editing || undefined}
        aria-label={editing?.kind === "title" ? "Box title" : editing?.kind === "body" ? "Box text" : "Text"}
        value={editing?.value ?? ""}
        wrap="off"
        rows={1}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        style={editorStyle}
        onChange={event => { if (editingRef.current) updateEdit(event.target.value, event.target.selectionStart, event.target.selectionEnd); }}
        onSelect={event => {
          const element = event.currentTarget;
          const current = editingRef.current;
          if (!current || (current.start === element.selectionStart && current.end === element.selectionEnd)) return;
          const next = { ...current, start: element.selectionStart, end: element.selectionEnd };
          editingRef.current = next;
          setEditing(next);
          setCaretOn(true);
        }}
        onKeyDown={event => {
          const current = editingRef.current;
          if (!current) return;
          if (event.key === "Escape" || (event.key === "Enter" && (current.kind === "title" || event.metaKey || event.ctrlKey))) {
            event.preventDefault();
            finishEdit();
            canvasRef.current?.focus({ preventScroll: true });
          } else if (event.key === "Tab") {
            event.preventDefault();
            switchEdit(event.shiftKey ? "title" : "body");
          } else if (event.key === "Home" || event.key === "End") {
            // Handled here: the browser otherwise scrolls the whole page for these keys.
            event.preventDefault();
            const element = event.currentTarget;
            const { value } = element;
            const backward = element.selectionDirection === "backward";
            const focus = backward ? element.selectionStart : element.selectionEnd;
            const anchor = backward ? element.selectionEnd : element.selectionStart;
            const lineStart = value.lastIndexOf("\n", focus - 1) + 1;
            const lineEnd = value.indexOf("\n", focus) < 0 ? value.length : value.indexOf("\n", focus);
            const whole = event.metaKey || event.ctrlKey;
            const target = event.key === "Home" ? (whole ? 0 : lineStart) : (whole ? value.length : lineEnd);
            const [start, end] = event.shiftKey ? [Math.min(anchor, target), Math.max(anchor, target)] : [target, target];
            element.setSelectionRange(start, end, event.shiftKey && target < anchor ? "backward" : "forward");
            const next = { ...current, start, end };
            editingRef.current = next;
            setEditing(next);
            setCaretOn(true);
          } else if (event.key === "PageUp" || event.key === "PageDown") {
            event.preventDefault();
          }
        }}
        onBlur={finishEdit}
      />, document.body)}

    <div className="draw-toolbar" role="toolbar" aria-label="Drawing tools">
      {tools.map(item => <button key={item.id} type="button" aria-pressed={tool === item.id} aria-label={item.label} title={`${item.label} (${item.key})`} onClick={() => { setTool(item.id); if (item.id !== "select") setSelection(null); }}>
        <span aria-hidden="true">{item.glyph}</span>
      </button>)}
      <span className="toolbar-divider" aria-hidden="true" />
      {palette.map(value => <button key={value} type="button" className="swatch" aria-pressed={color === value} aria-label={`Color ${value}`} title={value} style={{ "--swatch": value } as React.CSSProperties} onClick={() => recolor(value)} />)}
    </div>

    {selected.length > 1 && !editing && <div className="draw-inspector" aria-label="Selection properties">
      <div className="inspector-head">
        <span>{selected.length} selected</span>
        <button type="button" className="link danger" onClick={remove}>Delete</button>
      </div>
      <p className="hint">Drag any of them to move them together. Arrow keys nudge. Swatches recolour all.</p>
      <div className="inspector-actions">
        <button type="button" className="link" onClick={duplicate}>Duplicate ⌘D</button>
        <button type="button" className="link" onClick={() => setSelected([])}>Deselect</button>
      </div>
    </div>}

    {selection && !editing && selection.kind !== "text" && <Inspector
      key={`${selection.kind}:${selection.index}`}
      spec={doc}
      selection={selection}
      focusField={focusField}
      onFocused={onFocused}
      onChange={(next, mergeKey) => commit(next, mergeKey)}
      onDelete={remove}
      onSelect={setSelection}
      onIconChosen={setLastIcon}
    />}

    {isEmpty(doc) && !drag.current && !editing && <p className="draw-empty" aria-hidden="true">Pick a tool and start drawing. Press R for a box.</p>}

    <div className="draw-corner">
      <button type="button" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>↶</button>
      <button type="button" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}>↷</button>
      <span className="toolbar-divider" aria-hidden="true" />
      <button type="button" aria-label="Zoom out" title="Zoom out (⌘−)" disabled={zoom <= minZoom + 0.001} onClick={() => zoomBy(-1)}>−</button>
      <button type="button" className="zoom-level" aria-label="Reset zoom" title="Reset zoom (Shift+0)" onClick={() => zoomAt(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in" title="Zoom in (⌘+)" disabled={zoom >= maxZoom - 0.001} onClick={() => zoomBy(1)}>+</button>
      <button type="button" aria-label="Fit to content" title="Fit to content (Shift+1)" onClick={fit}>⤢</button>
    </div>
    <p className="draw-hint">{editing ? (editing.kind === "text" ? "Type. Enter adds a line. Esc or click away to finish." : "Type. Tab switches title and body. Esc or click away to finish.") : active.hint}</p>
    {message && <p className="draw-toast" role="status">{message}</p>}
  </div>;
}
