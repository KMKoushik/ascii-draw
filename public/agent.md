# Publish a diagram

## Preferred: MCP

If your client supports MCP, connect to `https://ascii.kdawg.dev/mcp` (Streamable HTTP, no auth). Call `diagram_guide`, draft a spec, check it with `render_diagram`, then `publish_diagram`, and give the user the returned url. To change an existing diagram, call `get_diagram`, edit the spec, render it, then `update_diagram` with the same link; the link stays the same.

## HTTP API

Create a JSON specification using the `ascii-diagram-png` skill format. Do not render or upload a PNG; the app renders in the viewer's browser.

POST `https://ascii.kdawg.dev/api/diagrams` with:

- `Content-Type: application/json`
- Body: `{ "title": "Descriptive title", "spec": <the diagram JSON> }` (`title` is optional)
- Optional `expiresAt`: a future ISO 8601 timestamp.

No auth is needed.

```sh
curl https://ascii.kdawg.dev/api/diagrams \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg title "System architecture" --slurpfile spec diagram.json '{title: $title, spec: $spec[0]}')"
```

On HTTP 201, return the response's `url` to the user as a Markdown link. Preserve the entire URL, including `?token=...`. The token is the only way to open that diagram, so don't post it publicly.

On HTTP 422, fix the spec using the returned error and retry. On 429, wait a minute. Don't repeatedly retry an unchanged failing request.

## Update a diagram

To change a diagram you already shared, PUT the new spec to the same diagram with its token. The link stays the same and shows the new version. Anyone with the full link can do this.

```sh
curl -X PUT "https://ascii.kdawg.dev/api/diagrams/<id>?token=<token>" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --slurpfile spec diagram.json '{spec: $spec[0]}')"
```

`title` is optional; omit it to keep the current title. HTTP 200 returns the same fields as publishing. HTTP 404 means the link is wrong, expired, or revoked. Give the user the same link again.

Limits: 256 KiB request body, 600 × 300 cells, 30 shares or updates per minute per IP.

Icons: use the skill's semantic shortcut IDs (for example `agent` or `datastore`) or any Tabler 3.46.0 ID such as `outline/browser` or `filled/heart`. Skip the skill's icon-fetch step; the app bundles the full catalog.
