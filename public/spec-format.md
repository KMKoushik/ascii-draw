# Diagram Specification

The renderer accepts one JSON object. JSON comments are not supported.

## Authoring preflight

Write these notes before the specification. They are design prompts, not JSON fields:

```text
Audience:
One-sentence claim:
Common path:
Decision or handoff:
Persistent identities:
Rare paths:
Requested outputs:
```

If the common path or persistent identity is unclear here, fix the content model before assigning coordinates. Read [composition.md](composition.md) for copy budgets, branch hierarchy, and continuity patterns.

## Root fields

```json
{
  "canvas": { "width": 64, "height": 24 },
  "boxes": [],
  "lines": [],
  "connectors": [],
  "arrows": [],
  "icons": [],
  "texts": [],
  "requiredLabels": [],
  "style": {}
}
```

- `canvas.width` and `canvas.height` are character-cell dimensions.
- Coordinates start at `0,0` in the top-left corner.
- All coordinates and dimensions are integers.
- Arrays other than `boxes` can be omitted.

## Hybrid SVG icons

Reserve blank character cells and select a pictogram from the full Tabler catalog or semantic shortcuts:

```json
{
  "id": "outline/browser",
  "x": 8,
  "y": 5,
  "width": 3,
  "height": 1,
  "color": "#c084fc"
}
```

Add entries to the root `icons` array. `x`, `y`, `width`, and `height` describe the reservation in the same character grid as the rest of the diagram. The reservation must be blank and inside the canvas. Reservations cannot overlap. `color` is required. `width` must fit the selected compact mark. The renderer reports the exact minimum for every icon. The current widest mark, `evaluation`, needs four columns.

The `.txt` file centers the icon's compact JetBrains Mono mark in the reservation. The PNG blanks only those cells and composites one SVG overlay after all text layers. Text, boxes, and connectors remain character-grid geometry. Unknown icons, collisions, overlaps, and out-of-bounds reservations are rejected.

Search the full catalog as described in [icon-library.md](icon-library.md). Put an exact catalog ID such as `outline/browser` or `filled/heart`, or one of the 39 canonical semantic shortcut IDs such as `agent`, in the `icons` array. Full-catalog icons need at least two columns for their neutral `<>` text placeholder; shortcut icons retain their existing marks. PNG output uses the actual SVG. Both outline and filled Tabler variants are available at a pinned version. Fetch selected catalog icons into an external cache before rendering; see the icon reference. SVG icons require `rsvg-convert`; use `--rsvg-convert <path>` only when auto-detection does not find it. For a hybrid render, the renderer also writes `TABLER-ICONS-LICENSE.txt` beside the PNG. Keep that notice with copied or distributed artifacts.

## Boxes

```json
{
  "id": "worker",
  "centerX": 31,
  "y": 8,
  "width": 28,
  "height": 7,
  "title": "WORKER",
  "lines": ["Run the task", "Upload the result"],
  "color": "#cc79a7",
  "textColor": "#e6edf3",
  "align": "center",
  "titleAlign": "center"
}
```

- Give every connected box a unique `id`.
- Set either `x` or `centerX`. `centerX` makes vertical layouts easier to align.
- `width` and `height` are minimum sizes. The renderer grows the box when its text needs more space.
- `align` is `left` or `center` for body text.
- `titleAlign` is `left` or `center` for the title in the top border.
- `color` colors the border and title in the PNG. `borderColor` and `titleColor` can override those parts. `textColor` colors the body. Missing colors use `style.foreground`.
- A box can contain another box. Partial box overlaps are rejected.

## Lines and connectors

`lines` draw paths without arrowheads. `connectors` draw paths and put an arrowhead at the final point.

A direct orthogonal polyline uses character-cell points:

```json
{
  "points": [[10, 4], [18, 4], [18, 9]],
  "color": "#2dd4bf"
}
```

A connection between box ports uses references:

```json
{
  "from": { "box": "source", "port": "bottom" },
  "to": { "box": "target", "port": "top" }
}
```

Ports are `top`, `right`, `bottom`, and `left`. The source point is on the source border. The target arrow sits one cell before the target border. This leaves the target frame intact.

For a controlled route, add `via` points:

```json
{
  "from": { "box": "source", "port": "right" },
  "via": [[50, 6], [50, 15]],
  "to": { "box": "target", "port": "right" },
  "arrow": "west"
}
```

Every pair of consecutive points must share an x-coordinate or a y-coordinate. With no `via` points, the renderer selects a simple orthogonal route. Set `route` to `horizontal-first` or `vertical-first` to select the bend order.

`arrow` is optional. Valid values are `north`, `east`, `south`, and `west`.

`color` colors the complete connector, including its arrowhead. Use `arrowColor` only when the arrowhead must differ. Plain `lines` also accept `color`.

When differently colored paths share one character cell, the operation drawn later owns that cell's color. Split shared rails into separate `lines` when a junction needs a deliberate neutral or destination color.

The last connector segment must enter the arrow in the arrow's travel direction. In particular, a `south` arrow must have a vertical final segment from above. The renderer converts a perpendicular approach into a dogleg, so this:

```text
────────▼
```

becomes this:

```text
───────┐
       │
       ▼
```

If a connector approaches an arrow from the opposite direction on the same axis, the renderer rejects it. Change the `via` points so the route approaches the arrow from behind.

## Standalone arrows

```json
{ "x": 31, "y": 6, "direction": "south", "color": "#7bd88f" }
```

Use standalone arrows only when a connector cannot express the intended geometry.

## Text

```json
{
  "x": 31,
  "y": 1,
  "value": "WORLD BUILDER",
  "anchor": "center",
  "color": "#e6edf3"
}
```

- Omit `x` to center text on the canvas.
- `anchor` is `left`, `center`, or `right`. The default is `left`.
- Text cannot cross a line. Set `overlay` to `true` only for an intentional line label.
- Newlines, tabs, and ANSI escape sequences are rejected.

## Required labels

Add every critical phrase to `requiredLabels`:

```json
["WORLD BUILDER", "Tool bridge", "Smoke test"]
```

The renderer fails when a required label is absent from the result.

## Style

```json
{
  "background": "#000000",
  "foreground": "#f2f2f2",
  "pointSize": 24,
  "lineSpacing": 2,
  "border": 48
}
```

Colors must be six-digit hexadecimal values. `border` is the pixel margin around the text image.

Operation colors affect only the PNG. The `.txt` output stays plain and byte-stable. For a restrained semantic palette on black, use near-white body text, muted gray structural frames, and a few accents such as blue for inputs, amber for slow paths, violet for agent work, teal for artifacts or traces, green for success, and vermillion for failure. Do not use color as the only signal.

## Complete example

```json
{
  "canvas": { "width": 50, "height": 18 },
  "texts": [
    { "y": 0, "value": "EXAMPLE PIPELINE" }
  ],
  "boxes": [
    {
      "id": "start",
      "centerX": 24,
      "y": 2,
      "width": 22,
      "height": 5,
      "title": "START",
      "lines": ["Receive input"]
    },
    {
      "id": "done",
      "centerX": 24,
      "y": 11,
      "width": 22,
      "height": 5,
      "title": "DONE",
      "lines": ["Publish output"]
    }
  ],
  "connectors": [
    {
      "from": { "box": "start", "port": "bottom" },
      "to": { "box": "done", "port": "top" }
    }
  ],
  "requiredLabels": ["EXAMPLE PIPELINE", "Receive input", "Publish output"],
  "style": {
    "background": "#000000",
    "foreground": "#f2f2f2",
    "pointSize": 24,
    "lineSpacing": 2,
    "border": 48
  }
}
```

Render and validate it with:

```sh
node <skill-directory>/scripts/render_ascii_diagram.mjs example.json --output /absolute/path/example
node <skill-directory>/scripts/render_ascii_diagram.mjs example.json --output /absolute/path/example --check
```
