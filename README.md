# ascii-diagram

An agent-first, token-protected diagram publisher. Cloudflare Workers serves the API and React app; D1 stores canonical JSON and hashed access tokens. The browser draws the PNG. No R2, KV, image service, or external runtime is needed.

Live app: https://ascii-diagram.kdawg.dev (also served at https://ascii.kdawg.dev)

UI components are adapted from [ascii-cn](https://ascii-cn.kdawg.dev/). The grid engine is extracted from the [`ascii-diagram-png` skill](skills/ascii-diagram-png) with its original routing and collision checks.

## Credits

The `ascii-diagram-png` skill, including its character-grid engine, spec format, composition rules, and icon library, was created by [danny (@godwhoa)](https://github.com/godwhoa). This app is built on his work. The skill is included in [`skills/ascii-diagram-png`](skills/ascii-diagram-png) under the MIT license.

## Install the skill

The skill lets a coding agent write diagram specs and render them to PNG on your machine. Install it with the [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add KMKoushik/ascii-diagram
```

Or copy the folder into your agent's skills directory by hand:

```sh
git clone https://github.com/KMKoushik/ascii-diagram
cp -R ascii-diagram/skills/ascii-diagram-png ~/.claude/skills/   # Claude Code
cp -R ascii-diagram/skills/ascii-diagram-png ~/.agents/skills/   # Codex and other agents
```

Local PNG rendering needs Node, [ImageMagick](https://imagemagick.org) (`magick`), and `rsvg-convert` (librsvg) for SVG icons. On macOS: `brew install imagemagick librsvg`. You don't need the skill to publish a link; agents can call the API or MCP server below.

## Web flow

Open the app, draw the diagram (or paste/upload JSON), set the title, press **Share →**, and copy the link. No login or key.

A share link opens the full editor on that diagram. Edits autosave to the same link (the top bar shows Saved / Saving… / Unsaved changes), so the link and its Slack preview always show the latest version. Invalid JSON is never saved. Anyone with the full link can view and edit. **New** starts a fresh diagram; **PNG ↓** downloads the current drawing.

**Draw** and **JSON** are two views of the same diagram JSON; edits in either show up in the other. The last-used view is remembered.

Draw tools (keyboard shortcut in brackets):

- **Typing is on the canvas.** Double-click anywhere (or use **Text**, T) and type where you clicked; Enter adds a line below. Double-click a box, or click it with the Text tool, to type inside it, centred as you go. The top border edits the title; Tab / Shift+Tab switches between title and body. Esc or clicking away finishes. Each finished edit is one undo step.
- **Select** (V): click to select, drag to move, corner handles to resize, arrow keys to nudge (Shift for 5), Delete to remove, ⌘D to duplicate, Enter to edit text. Moving a box carries everything inside it; arrows attached to boxes follow them.
- **Multi-select:** drag across empty space to select everything inside the rectangle (Shift adds to the selection), Shift-click to add or remove one item, ⌘A for everything. Drag any selected item to move the group together; arrow keys nudge it, Delete removes it, ⌘D duplicates it (arrows between copied boxes come too), and swatches recolour it. Clicking one member without dragging narrows the selection to it.
- **Infinite canvas:** the drawing area is a viewport over an unbounded grid. Scroll (two fingers or a wheel; Shift for sideways) to pan, or hold Space and drag, middle-drag, or use the Hand tool (H). Pinch or ⌘/Ctrl+scroll zooms around the cursor (25%–300%); ⌘+/⌘− step, Shift+0 resets, Shift+1 (⤢) fits the drawing. Drawing above or left of the content shifts everything so stored coordinates stay non-negative, without moving anything on screen. Drawings can be up to 600 × 300 cells.
- **Snapping:** while dragging, an element snaps (within one cell) to line up its left, centre, or right (top, middle, bottom) with other elements, and a guide line shows the alignment. Hold Alt to move freely.
- **Box** (R): drag to draw, or click for a default size, then type its title straight away.
- **Arrow** (A): drag from box to box (sides are picked automatically), or across empty space. The panel sets arrowhead on/off, route, and sides.
- **Icon** (I): click to place, then search all bundled icons in the panel.
- Colour swatches set the colour for new elements and recolour the selection. ⌘Z / ⇧⌘Z undo and redo; ⌘-scroll zooms. Pasting JSON while drawing loads it.

Every edit goes through the same engine and validation as rendering. Edits that would break the diagram, such as a partial box overlap or a line through text, are refused with a message instead of being applied. The canvas size is fitted to the content automatically.

## Publish from an agent

No auth is needed:

```sh
DIAGRAM_LINK_ORIGIN=https://ascii-diagram.kdawg.dev \
  node scripts/publish.mjs diagram.json "System architecture"
```

```sh
curl https://ascii-diagram.kdawg.dev/api/diagrams \
  -H 'Content-Type: application/json' \
  -d '{ "title": "System architecture", "spec": { ... } }'
```

The response is `{ id, url, title, createdAt, expiresAt }`. Send the complete `url`. `title` is optional; `expiresAt` (future ISO 8601) makes the link expire. There is no listing endpoint. Publishing and updating share a rate limit of 30 per minute per IP.

To change a diagram in place, `PUT` a new spec to the same diagram with its token. The link stays the same. Anyone with the full link can update it.

```sh
curl -X PUT 'https://ascii-diagram.kdawg.dev/api/diagrams/<id>?token=<token>' \
  -H 'Content-Type: application/json' \
  -d '{ "spec": { ... } }'
```

`title` is optional and keeps the current title when omitted. The response is `200` with `{ id, url, title, createdAt, expiresAt }`. A wrong, expired, or revoked token returns 404; an invalid spec returns 422. Agent instructions are at `/agent.md`, API docs at `/docs`, the spec reference at `/spec-format.md`.

## MCP server

Agents can connect over MCP (Streamable HTTP, no auth):

```
https://ascii-diagram.kdawg.dev/mcp
```

- **Claude Code:** `claude mcp add --transport http ascii-diagram https://ascii-diagram.kdawg.dev/mcp`
- **Cursor** (`~/.cursor/mcp.json`): `{ "mcpServers": { "ascii-diagram": { "url": "https://ascii-diagram.kdawg.dev/mcp" } } }`
- **OpenCode** (`opencode.json`): `{ "mcp": { "ascii-diagram": { "type": "remote", "url": "https://ascii-diagram.kdawg.dev/mcp" } } }`
- **Anything else:** add a remote/HTTP MCP server with that URL. For clients that only speak stdio, use `npx mcp-remote https://ascii-diagram.kdawg.dev/mcp`.

Tools:

| Tool | What it does |
|---|---|
| `diagram_guide` | The authoring guide: workflow, composition rules, grid, full spec reference, icons, layout recipes, and fixes for every validation error. |
| `render_diagram` | Validates a spec with the real engine and returns the exact ASCII rendering plus composition warnings. Nothing is saved. |
| `publish_diagram` | Validates, saves, and returns the private share link (`structuredContent.url`). |
| `get_diagram` | Opens a share link and returns its title, spec, and rendering, for revisions. |
| `update_diagram` | Validates a revised spec and saves it over an existing diagram. The share link stays the same. |
| `search_icons` | Finds icon ids (semantic shortcuts plus 6,000+ Tabler icons). |

Also exposed: resources `ascii-diagram://guide`, `ascii-diagram://examples/architecture`, and `ascii-diagram://examples/request-flow`, plus a `draw_diagram` prompt. The server's `instructions` tell agents the workflow (guide → draft → render → fix → publish → reply with the link).

The guide (`shared/mcp-guide.md`) is adapted from the ascii-diagram-png skill's spec format and composition rules, without the local renderer CLI steps. `render_diagram` warnings come from `shared/lint.ts` (compressed-list lines, long bodies, untitled or unconnected boxes, too many colours, missing `requiredLabels`). They never block publishing.

The endpoint is stateless (Cloudflare's `createMcpHandler` with MCP SDK v2). It serves 2025-era and 2026-07-28 clients, answers GET with 405, and rejects browser requests from foreign origins. Publishing and updating through MCP share the HTTP API's rate limit.

## Local development

Requires Node 22+ and npm.

```sh
npm ci
printf 'PUBLISH_API_KEY=local-test-key-not-for-production\n' > .dev.vars  # admin key for rotate/revoke
npm run db:local
npm run dev
```

`npm run dev` uses Vite and the Cloudflare plugin with local D1. For a production-mode local preview:

```sh
npm run build
npm run preview
```

## Checks

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests use the actual local Worker and D1, not mocked API responses. They cover open publishing, rate limiting, token scope, expiry, rotation, revocation, upload limits, the edit → share → copy flow, invalid JSON, mobile layout, icons, and real PNG/JSON downloads.

## Deploy to Cloudflare

`wrangler.jsonc` contains this deployment's D1 binding. For a separate deployment, create a database with `npx wrangler d1 create diagram-link` and update the account and database IDs.

```sh
npm run db:remote
npx wrangler secret put PUBLISH_API_KEY
npm run deploy
```

`PUBLISH_API_KEY` is an operator-only admin key for rotate and revoke (for example, to take down a link). Use a random 32-byte or stronger value. Secrets are never bundled into browser assets. Add a Workers custom domain in Cloudflare if desired; the default workers.dev URL also works.

## Access model

- Each diagram gets a cryptographically random 256-bit URL token. D1 stores only its SHA-256 hash. The raw token is returned once, in the URL.
- The token grants viewing and updating: anyone with the full link can replace the diagram's spec and title.
- HTML access and JSON reads both validate the token. Missing, incorrect, expired, revoked, or wrong-diagram tokens all return a generic 404.
- `POST /api/diagrams/:id/rotate-token` (admin Bearer key) returns a new URL and invalidates the previous one. Rotation restores a revoked diagram but does not extend its expiry.
- `POST /api/diagrams/:id/revoke` (admin Bearer key) blocks subsequent reads.
- Authorization reads use a primary D1 session so revocation is not delayed by replicas.
- All responses use `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, restrictive CSP, frame blocking, and no-index headers. The app loads no third-party scripts, fonts, icons, or analytics. Worker observability/request logs are disabled in configuration.
- Access links are bearer credentials: browser history and whoever receives the full link can retain it. Revocation cannot recall downloaded data. Treat URL-bearing screenshots and external infrastructure logs as sensitive.
- Publishing is open: anyone who can reach the app can create a diagram. A per-IP rate limit (30/minute) and body/canvas limits bound abuse. Nobody can list or read diagrams without the full link.
- Diagram drafts and links are not persisted in the browser.

## Renderer compatibility

`shared/engine.js` is generated from the skill's character-grid engine. Only Node filesystem icon loaders are replaced; geometry, junctions, arrows, text fallbacks, required-label and collision validation remain the original implementation. Both the Worker and browser validate with the same engine and schema.

`src/lib/render.ts` paints the resulting cells and SVG icon reservations onto a browser canvas using bundled JetBrains Mono. Layout semantics match the skill; font rasterization, font metrics, and thus exact PNG pixels/dimensions may differ from ImageMagick. This browser-native adapter is necessary because Workers cannot execute ImageMagick.

All 6,184 Tabler 3.46.0 outline and filled icons are served as static assets, with the original semantic shortcut vectors. PNGs are generated on demand and never stored. The plain text keeps compact icon marks; the PNG uses pictograms.

`scripts/sync-renderer.mjs` regenerates the port and assets from `ASCII_SKILL_DIR` (defaults to the in-repo `skills/ascii-diagram-png`). To pick up a skill update, replace that folder, run `npm run sync:renderer`, and review the diff. The generated engine, font, icons, and source reference are committed, so normal builds don't run the sync. `scripts/install-ui.mjs` fetches the ascii-cn components used here and applies compact sizing/focus adaptations; normal builds use the checked-in components.

Limits are intentional: 256 KiB request bodies, 600 × 300 cells, 500 boxes, 800 connectors, 300 icons, and point sizes 8–48. PNG export scales very large drawings down to 16 megapixels. The schema reports malformed input before grid allocation. Shortcuts and catalog IDs are allowlisted; diagram text is never interpreted as HTML or executable SVG.

Font and icon license notices are in `public/licenses`. Keep the Tabler notice with distributed icon-bearing outputs.

## License

MIT. See [LICENSE](LICENSE). The `ascii-diagram-png` skill is MIT, copyright danny ([@godwhoa](https://github.com/godwhoa)); see [skills/ascii-diagram-png/LICENSE](skills/ascii-diagram-png/LICENSE). JetBrains Mono is under the SIL Open Font License and Tabler Icons under MIT; their notices are in `public/licenses`.
