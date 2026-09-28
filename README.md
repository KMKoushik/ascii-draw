# Diagram Link

An agent-first, token-protected diagram publisher. Cloudflare Workers serves the API and React app; D1 stores canonical JSON and hashed access tokens. The browser draws the PNG. No R2, KV, image service, or external runtime is needed.

Live app: https://ascii-diagram.kdawg.dev

UI components are adapted from [ascii-cn](https://ascii.kdawg.dev/). The grid engine is extracted from the local `ascii-diagram-png` skill with its original routing and collision checks.

## Web flow

Open the app, draw the diagram (or paste/upload JSON), set the title, press **Share →**, and copy the link. No login or key.

**Draw** and **JSON** are two views of the same diagram JSON; edits in either show up in the other. The last-used view is remembered.

Draw tools (keyboard shortcut in brackets):

- **Select** (V): click to select, drag to move, corner handles to resize, arrow keys to nudge (Shift for 5), Delete to remove, ⌘D to duplicate, Enter to edit. Moving a box carries everything inside it; arrows attached to boxes follow them.
- **Box** (R): drag to draw, or click for a default size. Title, body lines, and alignment are in the properties panel.
- **Arrow** (A): drag from box to box (sides are picked automatically), or across empty space. The panel sets arrowhead on/off, route, and sides.
- **Text** (T): click to place a label. Double-clicking empty space also adds one.
- **Icon** (I): click to place, then search all bundled icons.
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

The response is `{ id, url, title, createdAt, expiresAt }`. Send the complete `url`. `title` is optional; `expiresAt` (future ISO 8601) makes the link expire. There is no listing endpoint. Publishing is rate limited to 30 per minute per IP. Agent instructions are at `/agent.md`, API docs at `/docs`, the spec reference at `/spec-format.md`.

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

`PUBLISH_API_KEY` is an operator-only admin key for rotate and revoke (for example, to take down a link). Use a random 32-byte or stronger value. This deployment's admin key is in `~/.config/diagram-link/credentials.env`. Secrets are never bundled into browser assets. Add a Workers custom domain in Cloudflare if desired; the default workers.dev URL also works.

## Access model

- Each diagram gets a cryptographically random 256-bit URL token. D1 stores only its SHA-256 hash. The raw token is returned once, in the URL.
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

`scripts/sync-renderer.mjs` regenerates the port and assets from `ASCII_SKILL_DIR` (defaults to `~/.agents/skills/ascii-diagram-png`). The generated engine, font, icons, and source reference are included, so normal builds need no locally installed skill. Review renderer updates before syncing. `scripts/install-ui.mjs` fetches the ascii-cn components used here and applies compact sizing/focus adaptations; normal builds use the checked-in components.

Limits are intentional: 256 KiB request bodies, 240 × 140 cells, 16 megapixels, 200 boxes, 300 connectors, 100 icons, and point sizes 8–48. The schema reports malformed input before grid allocation. Shortcuts and catalog IDs are allowlisted; diagram text is never interpreted as HTML or executable SVG.

Font and icon license notices are in `public/licenses`. Keep the Tabler notice with distributed icon-bearing outputs.
