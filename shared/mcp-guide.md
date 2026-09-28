# Making ASCII architecture diagrams

You describe a diagram as one JSON **spec** on a character grid. The server lays it out with the ascii-diagram-png engine (Unicode box art, orthogonal arrows, optional icons) and shares it as a private link. The viewer renders it in the browser in JetBrains Mono on black. The PNG is generated there on demand.

## Workflow

1. **Plan before coordinates.** Write these down for yourself; they are not JSON fields:
   - Audience, and the **one-sentence claim** the reader should remember.
   - The **common path** as a short spine, e.g. `client → api → db`.
   - True exception or branch paths, and where they rejoin.
   - Anything that keeps the **same identity** across phases (one sandbox, one process). Show that with an enclosing frame, not two lookalike boxes.
   - Each relationship as `source → action → target`. Don't invent calls or ownership to make the layout tidier.
2. **Draft the spec** (reference below). Start from an example resource if it helps.
3. **Call `render_diagram`** and read the ASCII it returns, character by character. Trace every arrow from source to target. Check that labels have breathing room and that no crossing implies a relationship that doesn't exist. Fix the spec and render again; don't hand-edit the text output.
4. **Call `publish_diagram`** with a descriptive title. Reply to the user with the returned `url` as a Markdown link. Keep the whole URL, including `?token=…`; the token is the only way to open it. Don't paste the link anywhere public.
5. **To revise** an existing diagram, call `get_diagram` with its URL, edit the returned spec, check it with `render_diagram`, then call `update_diagram` with the same URL. The link stays the same and shows the new version. Anyone with the full link can update it. `publish_diagram` always makes a new link instead.

## Composition rules

- **One job per box.** The title carries the meaning; the body has zero to three short lines, one idea each.
- **Don't compress structure into prose.** A line like `checkout · patch · boot · replay` hides a sequence. Make it separate boxes connected by arrows, or delete the detail. Established names like `patches/*.patch` are fine.
- **Common path first.** It should be the shortest, straightest route along one main reading direction (top→bottom or left→right). Put rare or recovery work on a short side branch; rejoin only when the states really are equivalent.
- **Precise outcome labels** such as `HIT`, `MISS`, `PASS`, `CONFIRMED BREAK` beat `yes`/`no`. Put them next to the split, with a clear gap from the line and arrowhead.
- **Containment is a frame**, not a sentence. A box may fully contain other boxes; partial overlap is rejected.
- **Don't repeat** what a title, icon, arrow, colour, or frame already says. Leave secondary implementation details out of an overview.
- **Spacing:** keep at least one empty column between unrelated boxes and one empty row between a box and an unrelated connector.
- **Colour supports meaning; it never carries it alone.** Keep body text near-white; colour borders, titles, connectors, and key labels. A restrained palette on black:
  - `#79bdff` blue: inputs, entry points, interactive
  - `#c4a7ff` violet: agent or compute work
  - `#7fdbca` teal: shared services, artifacts, traces
  - `#b7e3a1` green: success, output
  - `#ffd15b` amber: storage, slow paths, attention
  - `#ff9d91` vermillion: failure
  - `#929da7` grey: secondary text and frames
  - `#e8e8e5` near-white: body text and titles

## The grid

- Coordinates are integer character cells; `0,0` is the top-left; `x` grows right and `y` grows down.
- A cell is about twice as tall as it is wide. A box that looks square is roughly twice as wide as it is tall, in cells.
- `canvas.width` × `canvas.height` must contain everything (max 240 × 140). Trailing blank rows and columns are trimmed from the output, so a little slack is harmless.

## Spec reference

```json
{
  "canvas": { "width": 64, "height": 24 },
  "boxes": [], "connectors": [], "lines": [], "arrows": [], "icons": [], "texts": [],
  "requiredLabels": [],
  "style": { "background": "#000000", "foreground": "#e8e8e5", "pointSize": 24, "lineSpacing": 2, "border": 32 }
}
```

Only `canvas` is required. Unknown fields are rejected. Colours are six-digit hex.

### Boxes

```json
{ "id": "worker", "centerX": 31, "y": 8, "width": 28, "height": 7, "title": "WORKER",
  "lines": ["Run the task", "Upload the result"], "color": "#c4a7ff", "align": "center", "titleAlign": "center" }
```

- Give every box that a connector touches a unique `id`.
- Set `x` (left edge) or `centerX`. `centerX` makes vertical stacks easy to align.
- `width`/`height` are minimums. The box grows to fit `title` (title length + 4) and lines (longest + 4 wide, count + 2 tall).
- The title sits centred in the top border (`titleAlign: "left"` puts it at `x + 2`). Body lines are centred vertically; each line is centred horizontally unless `align` is `"left"`.
- `color` sets border and title; `borderColor`, `titleColor`, and `textColor` override the parts.
- Height 5 gives one centred body row (at `y + 2`); height 7 fits three.

### Connectors (with arrowheads) and lines (without)

Between box sides (preferred):

```json
{ "from": { "box": "api", "port": "bottom" }, "to": { "box": "db", "port": "top" }, "color": "#ffd15b" }
```

- Ports: `top`, `right`, `bottom`, `left`, each at the centre of that side. The source point is on the source border. The arrowhead sits one cell outside the target border, so leave at least two empty cells between boxes you connect.
- With no `via`, the route is picked automatically; `"route": "horizontal-first"` or `"vertical-first"` picks the bend order.
- `via: [[x, y], …]` forces a path. Consecutive points must share an x or a y (orthogonal only).
- Raw polylines are allowed too: `{ "points": [[10, 4], [18, 4], [18, 9]] }`. `from`/`to` may also be `[x, y]` points.
- `arrow` (`north`/`east`/`south`/`west`) is inferred from the target port. The last segment must travel in the arrow's direction: a `south` arrow needs a vertical final segment coming from above. Perpendicular approaches are turned into a short dogleg; approaches from the opposite direction are rejected.
- Paths may cross box borders; junction glyphs are drawn automatically. Crossing text is an error.
- `lines` take the same fields, without an arrowhead.
- When differently coloured paths share a cell, the one drawn later owns that cell's colour.

### Text labels

```json
{ "x": 31, "y": 1, "value": "WORLD BUILDER", "anchor": "center", "color": "#e8e8e5" }
```

- One line per label; no tabs, newlines, or control characters. Omit `x` to centre on the canvas. `anchor` is `left` (default), `center`, or `right`.
- Text may not cross a line or border unless `"overlay": true`. Use overlay only for deliberate on-line labels.

### Icons

```json
{ "id": "outline/database", "x": 46, "y": 16, "width": 4, "height": 3, "color": "#ffd15b" }
```

- An icon reserves a blank rectangle of cells. The rectangle must be inside the canvas and hold nothing else: no text, borders, lines, or other icons.
- IDs are either semantic shortcuts (`agent`, `model`, `api`, `datastore`, `queue`, `worker`, `function`, `cache`, `object-store`, `webhook`, `secret`, `logs`, `trace`, …) or any Tabler 3.46.0 id such as `outline/browser`, `outline/brand-cloudflare`, `filled/heart`. Use `search_icons` to find them. Prefer `outline/` icons in one diagram.
- Minimum width is the icon's text mark: 2 for catalog icons, up to 4 for shortcuts (`EVAL`). **4 × 3 is a safe size.**
- The plain-text rendering shows a compact mark (`⍟`, `⌸`, or `<>` for catalog icons); the browser draws the real pictogram. Always keep a text label next to an icon.
- **Icon inside a box:** in a box at `x, y`, 5 tall and at least 28 wide, put a 4 × 3 icon at `x + 2, y + 1`. Keep the centred body text short enough to start at or after `x + 7`: the text starts at `x + floor((width − length) / 2)`. Otherwise widen the box or use `"align": "left"`, and don't place an icon at the same spot.

### Standalone arrowheads

`{ "x": 31, "y": 6, "direction": "south", "color": "#b7e3a1" }`. Only use these when a connector can't express the shape.

### requiredLabels

List every critical phrase (box titles, outcome labels). Rendering fails if one is missing, which catches silent breakage.

## Layout recipes

- **Vertical flow:** give every box the same `centerX`, with `y` steps of box height + 3 (e.g. `y` 2, 10, 18 for height-5 boxes), and connect `bottom → top`.
- **Horizontal pipeline:** same `y`, `x` steps of width + 6 or more, connect `right → left`.
- **Side branch:** put the branch box to the right of the step that splits (a gap of 6+ columns), connect `right → left`, and label the branch above its line (`y − 1` of the port row).
- **2 × 2 grid:** see the `architecture` example (76 × 24): boxes 30 × 5 at (2, 6), (44, 6), (2, 15), (44, 15).
- **Containment:** an outer frame box with a `title` and no body, sized to wrap its children with a margin of at least 2 columns and 1 row.

## Errors you will see and fixes

- `Text crosses a line at x,y`: move the label, reroute with `via`, or shorten the text.
- `Boxes overlap: a and b`: separate them, or make one fully contain the other.
- `SVG icon … collides with diagram content`: the icon's rectangle overlaps text or a line. Move it, or narrow or move the text.
- `Box content is too wide/tall`, `Box title is too wide`: usually from explicit sizes; widen the box or drop `width`/`height`.
- `Point is outside the W×H canvas`, `Text exceeds the canvas`: enlarge `canvas`.
- `… arrow … does not have a clean incoming stem` / `approaches … from the wrong direction`: change the ports or add `via` so the final segment points into the target.
- `Line is not reciprocal` or junction errors: two paths meet in a way the box-drawing glyphs can't express. Offset one path by a cell.
- `Required label is missing`: the label didn't render (overwritten or misspelled). Check the text.

## Limits

256 KiB per request · canvas up to 240 × 140 cells · 16 megapixels at the chosen point size (8–48) · 200 boxes · 300 connectors, lines, and texts each · 100 icons · 30 publishes or updates per minute per IP.
