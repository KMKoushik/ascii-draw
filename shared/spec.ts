import { z } from "zod";
import { buildDiagram } from "./engine.js";

const color = z.string().regex(/^#[\da-f]{6}$/i, "Use a six-digit hex color");
const coord = z.number().int().min(0).max(600);
const text = z.string().max(240).regex(/^[^\n\r\t\u001b\u0000]*$/, "Use single-line text without control characters");
const point = z.tuple([coord, coord]);
const endpoint = z.union([point, z.object({ box: z.string().max(100), port: z.enum(["top", "right", "bottom", "left"]) }).strict()]);
const direction = z.enum(["north", "east", "south", "west"]);
const path = z.object({
  points: z.array(point).min(2).max(100).optional(),
  from: endpoint.optional(), to: endpoint.optional(), via: z.array(point).max(100).optional(),
  route: z.enum(["horizontal-first", "vertical-first"]).optional(),
  arrow: direction.optional(), color: color.optional(), arrowColor: color.optional(),
}).strict();

export const specSchema = z.object({
  canvas: z.object({ width: z.number().int().min(4).max(600), height: z.number().int().min(3).max(300) }).strict(),
  boxes: z.array(z.object({
    id: z.string().min(1).max(100).optional(), x: coord.optional(), centerX: coord.optional(), y: coord,
    width: coord.optional(), height: coord.optional(), title: text.optional(), lines: z.array(text).max(100).optional(),
    align: z.enum(["left", "center"]).optional(), titleAlign: z.enum(["left", "center"]).optional(),
    color: color.optional(), borderColor: color.optional(), titleColor: color.optional(), textColor: color.optional(),
  }).strict()).max(500).optional(),
  lines: z.array(path).max(800).optional(), connectors: z.array(path).max(800).optional(),
  arrows: z.array(z.object({ x: coord, y: coord, direction, color: color.optional() }).strict()).max(800).optional(),
  icons: z.array(z.object({ id: z.string().min(1).max(100), x: coord, y: coord, width: coord.min(1), height: coord.min(1), color }).strict()).max(300).optional(),
  texts: z.array(z.object({ x: coord.optional(), y: coord, value: text, anchor: z.enum(["left", "center", "right"]).optional(), color: color.optional(), overlay: z.boolean().optional() }).strict()).max(800).optional(),
  requiredLabels: z.array(text).max(800).optional(),
  style: z.object({ background: color.optional(), foreground: color.optional(), pointSize: z.number().int().min(8).max(48).optional(), lineSpacing: z.number().int().min(-20).max(40).optional(), border: z.number().int().min(0).max(128).optional() }).strict().optional(),
}).strict();

export type Spec = z.infer<typeof specSchema>;
export function validateSpec(input: unknown) {
  const parsed = specSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${issue.path.join(".") || "spec"}: ${issue.message}`);
  }
  const spec = parsed.data;
  const size = spec.style?.pointSize ?? 24;
  const advance = size * 1.32 + (spec.style?.lineSpacing ?? 2);
  if (advance <= 0) throw new Error("style.lineSpacing must leave a positive row height");
  // Large drawings are fine: PNG export scales its font down to stay within its pixel budget.
  const diagram = buildDiagram(spec);
  if (!diagram.text.trim()) throw new Error("Add at least one box or label to the diagram");
  return { spec, diagram };
}
