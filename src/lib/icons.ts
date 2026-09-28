import catalog from "../../shared/icon-catalog.json";
import library from "../../shared/icon-library.json";

export type IconOption = { id: string; preview: string };

const shortcuts: IconOption[] = Object.entries(library.icons as Record<string, { sourceIcon: string }>)
  .map(([id, definition]) => ({ id, preview: `/icons/outline/${definition.sourceIcon}.svg` }));
const catalogOptions: IconOption[] = (catalog as string[]).map(id => ({ id, preview: `/icons/${id}.svg` }));
const all = [...shortcuts, ...catalogOptions];
const byId = new Map(all.map(option => [option.id, option]));

const favorites = [
  "agent", "model", "api", "datastore", "queue", "worker", "function", "cache", "object-store", "webhook", "secret", "logs",
  "outline/server", "outline/cloud", "outline/browser", "outline/device-mobile", "outline/user", "outline/users",
  "outline/lock", "outline/mail", "outline/world", "outline/brand-github", "outline/brand-cloudflare", "outline/brand-aws",
  "outline/settings", "outline/file", "outline/folder", "outline/chart-bar", "outline/bolt", "outline/message",
];
const defaults = favorites.map(id => byId.get(id)).filter((option): option is IconOption => !!option);

export function iconPreview(id: string) {
  return byId.get(id)?.preview ?? `/icons/${id}.svg`;
}

export function searchIcons(query: string, limit = 48) {
  const q = query.trim().toLowerCase().replace(/\s+/g, "-");
  if (!q) return defaults;
  const name = (id: string) => id.replace(/^(outline|filled)\//, "");
  const scored: [number, IconOption][] = [];
  for (const option of all) {
    const n = name(option.id);
    const index = n.indexOf(q);
    if (index < 0) continue;
    const score = (n === q ? 0 : index === 0 ? 1 : 2) * 10 + (option.id.startsWith("filled/") ? 1 : 0);
    scored.push([score, option]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].id.length - b[1].id.length);
  return scored.slice(0, limit).map(([, option]) => option);
}
