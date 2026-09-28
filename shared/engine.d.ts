export type Cell = { glyph: string; color: string | null };
export type Icon = { id: string; x: number; y: number; width: number; height: number; color: string };
export type Diagram = { text: string; cells: Cell[][]; pngCells: Cell[][]; icons: Icon[] };
export type IconElement = { type: string; [key: string]: string | number };
export type IconDefinition = { mark: string; elements?: IconElement[]; variant?: string; asset?: string; sourceIcon?: string };
export type Point = [number, number];
export type Port = "top" | "right" | "bottom" | "left";
export type MeasuredBox = { id?: string; x: number; y: number; width: number; height: number; title: string; lines: string[] };

export function buildDiagram(spec: unknown): Diagram;
export function loadSvgIconLibrary(): { icons: Record<string, IconDefinition> };
export function loadCatalogIcon(id: string): IconDefinition;
export function measureBox(box: unknown): MeasuredBox;
export function resolvePath(operation: unknown, boxes: Map<string, MeasuredBox>): { points: Point[]; targetPort: Port | null };
export function normalizePathPoints(points: Point[]): Point[];
export function ensureArrowApproach(points: Point[], direction: string): Point[];
export function inferArrow(points: Point[], targetPort: Port | null): string;
export function displayWidth(value: string): number;
