---
name: ascii-diagram-png
description: Create or revise clear terminal-style architecture diagrams as aligned Unicode box art and JetBrains Mono PNGs. Use for ASCII diagrams, terminal diagrams, alignment repair, information-density reduction, infrastructure icons, hybrid SVG and text diagrams, or black-background PNG export. Do not use Mermaid or a Mermaid-backed renderer.
---

# ASCII Diagram PNG

Create a diagram that is readable at a glance and correct at the character-cell level. Icons, semantic colors, and visual structure are required, not optional decoration. Let geometry show sequence, branching, containment, and reuse. Use text to name nodes and outcomes.

## Required Visual Standard

- Give every major node a relevant icon and a short label. Use a small, consistent color palette to distinguish roles, paths, or outcomes. Follow an explicit user request for text-only, monochrome, or no icons; otherwise always include icons and colors in the PNG.
- A diagram must explain through placement, connections, branching, containment, and visual hierarchy. Do not turn a paragraph into a row of text boxes, or wrap prose inside a box and call it a diagram.
- Keep body text to short labels or essential data. Put explanations in the accompanying response. Requested SQL fields, payloads, and other structured data can remain inside nodes; explanatory paragraphs cannot.
- Apply the body-text removal check: ignore the body copy and verify that icons, titles, connections, and grouping still communicate the main relationship. If the meaning disappears, redesign the structure before delivery. Do not add a box for every phrase merely to reduce text per box.
- A rendering failure is not a reason to silently remove icons or colors. Correct the rendering path, then inspect the complete PNG again.

## Workflow

1. Deliver a PNG with icons and semantic colors, plus editable ASCII and JSON, by default. “ASCII diagram” describes the visual style unless the user explicitly requests text-only output. Follow explicit format restrictions. Do not add mobile, responsive, HTML, or alternate-ratio layouts unless requested.
2. Record the audience, then write one sentence that states the diagram's main claim. Reduce the main flow to a short sequence. Mark the common path, true exception paths, and any entity that must keep the same identity across phases before choosing coordinates.
3. Preserve the user's semantic intent when revising a diagram. Keep existing wording only when it remains the clearest expression of that intent. Before routing, list each relationship as source, action, and target. Mark uncertain relationships; do not invent ownership or calls to make the layout cleaner.
4. Read [references/composition.md](references/composition.md) before choosing the layout and [references/spec-format.md](references/spec-format.md) before creating the specification. Read the icon catalog and select icons and their semantic colors before reserving layout space: [references/icon-library.md](references/icon-library.md).
5. Create one canonical JSON specification in a task-owned writable output directory. Keep the JSON with the final artifacts so the diagram stays editable. Use the bundled renderer; do not create a custom generator unless the bundled renderer cannot express a required result.
6. Run the bundled renderer:

   ```sh
   node <skill-directory>/scripts/render_ascii_diagram.mjs <spec.json> --output <absolute-output-base>
   ```

7. Inspect the PNG fit-to-view and at original detail. At fit-to-view size, require a clear five-second message, recognizable icons, meaningful color, and a layout that passes the body-text removal check. Original detail and temporary crops test borders, arrows, labels, and icon overlays. Trace each connection from source to target and check that no crossing or shared segment adds an unintended relationship. Correct the JSON specification and re-render; do not patch the generated text file by hand.
8. Verify that the artifacts match the specification. This check proves freshness and deterministic rendering, not readability:

   ```sh
   node <skill-directory>/scripts/render_ascii_diagram.mjs <spec.json> --output <absolute-output-base> --check
   ```

9. Embed the PNG directly in the final response; a tool preview or download link alone is not delivery. Include links to the PNG and editable text and JSON sources. For a hybrid diagram, also link the generated `TABLER-ICONS-LICENSE.txt` notice. Honor explicit text-only requests instead of embedding an image.

## Composition Rules

- Give each box one job. Let its title carry most of the meaning; keep its body short.
- Treat a line with several separators, clauses, or list items as a structure warning. Split it into separate steps or separate lines, or remove details that do not change the reader's model. Do not use strings such as `apply · boot · replay · trace` as a substitute for geometry. Established names and paths such as `patches/*.patch` are not list compression.
- Treat about three short body lines as a review threshold, not a hard limit. A longer body must have a clear list or payload purpose.
- Make the common path the shortest and most direct route. Put rare recovery or fallback work on a side branch. Rejoin paths only after they produce equivalent state.
- Use precise outcome labels such as `PASS` or `CONFIRMED BREAK` when `yes` and `no` would force the reader to look backward.
- Show identity and continuity with geometry. If one sandbox, process, snapshot, or artifact continues into the next phase, use one enclosing frame or an explicit continuation. Do not draw a replacement-looking peer box and explain sameness only in prose.
- Remove secondary implementation details from an overview. Add a separate detail diagram only when the user asks for those details or they are necessary to understand the decision.
- Do not repeat information already conveyed by a title, icon, arrow, color, or enclosing frame.

## Rules

- Never use Mermaid or a renderer that uses Mermaid internally.
- Do not use image generation for text-heavy terminal diagrams.
- Use the bundled JetBrains Mono font unless the user asks for a different font.
- Use SVG icons from the full Tabler catalog for the major nodes in every PNG diagram. Search it before concluding that an icon is unavailable. The 39 semantic shortcuts are not the full catalog. Prefer outline icons for a consistent diagram; filled variants are also available. Do not mix another icon family into one diagram. Use the compact JetBrains Mono mark in dense text diagrams and the 7-by-3 badge in larger ASCII nodes. Add a root `icons` reservation from [references/spec-format.md](references/spec-format.md). Fetch uncached catalog icons with the helper in the icon reference before rendering. The plain-text file keeps the compact mark while the PNG replaces only its reserved blank cells with the SVG pictogram. Keep a text label with every icon. Do not invent emoji-based icons.
- Treat the ASCII grid as the source of truth. SVG icons can occupy only explicit blank reservations and must not cover text, borders, or connectors.
- Use a black background and near-white text by default.
- Keep generated text files plain and color-free. Never put ANSI color escapes in the ASCII artifact.
- Always use a small, high-contrast semantic color palette in PNG diagrams. Apply it consistently to icons, borders, titles, connectors, arrowheads, and key outcomes; keep body text near-white. Assign a meaning to each color before layout. Keep that meaning visible through labels and geometry as well as color.
- Use orthogonal connectors. Add explicit `via` points for branches, loops, or crowded routes.
- Give every arrow a final stem in its travel direction. A down arrow must be approached vertically from above. Never end a horizontal run with `─▼`; route to the side, turn down, and then place `▼`.
- Use `requiredLabels` for important text so validation catches missing content.
- Increase the canvas or reroute a connector when content collides. Do not hide a collision with spaces or a background patch.
- Keep at least one empty character column between unrelated boxes and one empty row between a box and an unrelated connector.
- Prefer one main reading direction. Use short side branches only when they clarify the architecture.
- Keep labels off connector runs unless the label intentionally overlays that connector. A branch label should have visible space from the line and arrowhead.

## Revision Behavior

When the user supplies existing ASCII art, treat its intended message as the source of truth. Convert it into a JSON specification, repair its geometry, and compare it with the original. Preserve meaningful nodes and boundaries, but remove accidental wording, duplicate labels, and implementation notes that obscure the main flow.

If the copy is dense, simplify the narrative. If the geometry is still crowded, enlarge the grid or reroute connectors. Do not solve information density by expanding the canvas or shrinking the font.
