import type { Spec } from "./spec";

// Readability checks from the ascii-diagram-png composition rules. They never block publishing.
export function lintSpec(spec: Spec): string[] {
  const warnings: string[] = [];
  const separators = (line: string) => (line.match(/·|•|;|\||→|->|,|\s\/\s|\s\+\s/g) ?? []).length;

  for (const box of spec.boxes ?? []) {
    const name = box.title ? `"${box.title}"` : `at ${box.x ?? box.centerX},${box.y}`;
    const lines = box.lines ?? [];
    if (!box.title) warnings.push(`Box ${name} has no title. Titles carry most of the meaning.`);
    if (lines.length > 3) warnings.push(`Box ${name} has ${lines.length} body lines. Keep bodies to about three short lines, or split the box into steps.`);
    for (const line of lines) {
      if (separators(line) >= 2) warnings.push(`Box ${name} line "${line}" reads like a compressed list. Split it into separate lines, boxes, or steps.`);
      if ([...line].length > 36) warnings.push(`Box ${name} line "${line}" is long. Shorten it so the box stays readable.`);
    }
  }
  for (const text of spec.texts ?? []) {
    if (separators(text.value) >= 3) warnings.push(`Label "${text.value}" reads like a compressed list. Use geometry instead of separators.`);
  }

  const colors = new Set<string>();
  const add = (color?: string) => { if (color) colors.add(color.toLowerCase()); };
  for (const box of spec.boxes ?? []) { add(box.color); add(box.borderColor); add(box.titleColor); }
  for (const path of [...(spec.connectors ?? []), ...(spec.lines ?? [])]) add(path.color);
  for (const icon of spec.icons ?? []) add(icon.color);
  for (const text of spec.texts ?? []) add(text.color);
  if (colors.size > 7) warnings.push(`${colors.size} colours are in use. A small palette with consistent meaning reads better.`);

  const boxes = spec.boxes ?? [];
  const connected = new Set<string>();
  for (const path of [...(spec.connectors ?? []), ...(spec.lines ?? [])]) {
    for (const end of [path.from, path.to]) if (end && !Array.isArray(end)) connected.add(end.box);
  }
  if (boxes.length > 2 && !(spec.connectors?.length || spec.lines?.length)) warnings.push("No connectors. Arrows usually carry the story between boxes.");
  const loose = boxes.filter(box => box.id && !connected.has(box.id) && !boxes.some(other => other !== box && contains(other, box)));
  if (boxes.length > 1 && loose.length && (spec.connectors?.length ?? 0) > 0) {
    warnings.push(`Unconnected boxes: ${loose.map(box => box.title ?? box.id).join(", ")}. Connect them, frame them, or remove them.`);
  }
  if (!spec.requiredLabels?.length) warnings.push("No requiredLabels. List the critical titles so a broken render is caught.");
  return warnings;
}

function contains(outer: NonNullable<Spec["boxes"]>[number], inner: NonNullable<Spec["boxes"]>[number]) {
  if (outer.x === undefined || inner.x === undefined || outer.width === undefined || inner.width === undefined) return false;
  return inner.x > outer.x && inner.y > outer.y && inner.x + inner.width < outer.x + outer.width && inner.y + (inner.height ?? 3) < outer.y + (outer.height ?? 3);
}
