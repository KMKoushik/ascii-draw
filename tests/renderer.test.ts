import { describe, expect, it } from "vitest";
import { validateSpec } from "../shared/spec";
import example from "../shared/example.json";

describe("skill-compatible rendering", () => {
  it("preserves box junctions, labels, arrow stems and plain output", () => {
    const { diagram } = validateSpec(example);
    const rows = diagram.text.split("\n");
    expect(rows[8][31]).toBe("├");
    expect(rows[8][43]).toBe("▶");
    expect(rows[14][58]).toBe("▼");
    expect(rows[13][58]).toBe("│");
    expect(rows[17][32]).toBe("◀");
    expect(diagram.icons.map(icon => icon.id)).toEqual(["agent", "outline/brand-cloudflare", "outline/browser", "datastore"]);
    expect(diagram.text).not.toContain("\u001b");
    for (const label of example.requiredLabels) expect(diagram.text).toContain(label);
  });

  it("keeps text marks and SVG blank reservations distinct for shortcuts and catalog icons", () => {
    const { diagram } = validateSpec({ canvas: { width: 24, height: 8 }, boxes: [], icons: [
      { id: "agent", x: 2, y: 2, width: 3, height: 2, color: "#79bdff" },
      { id: "outline/browser", x: 10, y: 2, width: 3, height: 2, color: "#ffd15b" },
      { id: "filled/heart", x: 18, y: 2, width: 3, height: 2, color: "#ff9d91" },
    ] });
    expect(diagram.text).toContain("⍟");
    expect(diagram.text.match(/<>/g)).toHaveLength(2);
    expect(diagram.pngCells.flat().every(cell => cell.glyph === " ")).toBe(true);
    expect(diagram.icons).toHaveLength(3);
  });

  it("rejects invalid geometry, missing labels and unknown icons", () => {
    expect(() => validateSpec({ ...example, requiredLabels: ["NOT IN OUTPUT"] })).toThrow("Required label");
    expect(() => validateSpec({ ...example, icons: [{ id: "agent", x: 2, y: 6, width: 3, height: 1, color: "#79bdff" }] })).toThrow("collides");
    expect(() => validateSpec({ ...example, icons: [{ id: "outline/not-an-icon", x: 0, y: 3, width: 3, height: 1, color: "#79bdff" }] })).toThrow("Unknown SVG icon");
    expect(() => validateSpec({ ...example, lines: [{ points: [[0, 0], [3, 3]] }] })).toThrow("orthogonal");
  });

  it("rejects pathological allocation and unsafe inputs before building", () => {
    expect(() => validateSpec({ canvas: { width: 1e9, height: 1e9 } })).toThrow();
    expect(() => validateSpec({ ...example, style: { pointSize: 1e9 } })).toThrow();
    expect(() => validateSpec({ ...example, texts: [{ y: 0, value: "hello\u0000" }] })).toThrow();
    expect(() => validateSpec({ ...example, style: { background: "url(https://example.com)" } })).toThrow();
    expect(() => validateSpec({ canvas: { width: 50, height: 20 } })).toThrow("at least one");
  });
});
