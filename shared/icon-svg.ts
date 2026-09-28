import { loadCatalogIcon, loadSvgIconLibrary, type IconElement } from "./engine.js";

function escape(value: string | number) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function elementSvg(element: IconElement) {
  const { type, ...attributes } = element;
  return `<${type} ${Object.entries(attributes).map(([key, value]) => `${key}="${escape(value)}"`).join(" ")}/>`;
}

// The viewer and the link preview image both paint icons from this markup.
export async function iconSvg(id: string, color: string, loadAsset: (path: string) => Promise<string>) {
  const definition = loadSvgIconLibrary().icons[id] ?? loadCatalogIcon(id);
  const svg = definition.asset
    ? await loadAsset(definition.asset)
    : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${definition.elements!.map(elementSvg).join("")}</svg>`;
  return svg.replaceAll("currentColor", color);
}
