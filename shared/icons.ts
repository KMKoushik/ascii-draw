import catalog from "./icon-catalog.json";
import library from "./icon-library.json";

export type IconOption = { id: string; preview: string };
type Searchable = IconOption & { names: string[] };

// Shortcuts also match the Tabler icon they draw, so "database" finds "datastore".
const shortcuts: Searchable[] = Object.entries(library.icons as Record<string, { sourceIcon: string }>)
  .map(([id, definition]) => ({ id, preview: `/icons/outline/${definition.sourceIcon}.svg`, names: [id, definition.sourceIcon] }));
const catalogOptions: Searchable[] = (catalog as string[]).map(id => ({ id, preview: `/icons/${id}.svg`, names: [id.replace(/^(outline|filled)\//, "")] }));
const all = [...shortcuts, ...catalogOptions];
const byId = new Map(all.map(option => [option.id, option]));

const favorites = [
  "agent", "model", "api", "datastore", "queue", "worker", "function", "cache", "object-store", "webhook", "secret", "logs",
  "outline/server", "outline/cloud", "outline/browser", "outline/device-mobile", "outline/user", "outline/users",
  "outline/lock", "outline/mail", "outline/world", "outline/brand-github", "outline/brand-cloudflare", "outline/brand-aws",
  "outline/settings", "outline/file", "outline/folder", "outline/chart-bar", "outline/bolt", "outline/message",
];
const defaults: IconOption[] = favorites.map(id => byId.get(id)).filter((option): option is Searchable => !!option).map(({ id, preview }) => ({ id, preview }));

export function iconPreview(id: string) {
  return byId.get(id)?.preview ?? `/icons/${id}.svg`;
}

export function searchIcons(query: string, limit = 48) {
  const q = query.trim().toLowerCase().replace(/\s+/g, "-");
  if (!q) return defaults;
  const scored: [number, IconOption][] = [];
  for (const option of all) {
    let best = Infinity;
    for (const name of option.names) {
      const index = name.indexOf(q);
      if (index >= 0) best = Math.min(best, name === q ? 0 : index === 0 ? 1 : 2);
    }
    if (best === Infinity) continue;
    scored.push([best * 10 + (option.id.startsWith("filled/") ? 1 : 0), { id: option.id, preview: option.preview }]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].id.length - b[1].id.length);
  return scored.slice(0, limit).map(([, option]) => option);
}
