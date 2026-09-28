export type Cell = { glyph: string; color: string | null };
export type Icon = { id: string; x: number; y: number; width: number; height: number; color: string };
export type Diagram = { text: string; cells: Cell[][]; pngCells: Cell[][]; icons: Icon[] };
export type IconElement = { type: string; [key: string]: string | number };
export type IconDefinition = { mark: string; elements?: IconElement[]; variant?: string; asset?: string };
export function buildDiagram(spec: unknown): Diagram;
export function loadSvgIconLibrary(): { icons: Record<string, IconDefinition> };
export function loadCatalogIcon(id: string): IconDefinition;
