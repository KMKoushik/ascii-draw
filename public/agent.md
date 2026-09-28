# Publish a diagram

Create a JSON specification using the `ascii-diagram-png` skill format. Do not render or upload a PNG; the app renders in the viewer's browser.

POST `https://ascii-diagram.kdawg.dev/api/diagrams` with:

- `Content-Type: application/json`
- Body: `{ "title": "Descriptive title", "spec": <the diagram JSON> }` (`title` is optional)
- Optional `expiresAt`: a future ISO 8601 timestamp.

No auth is needed.

```sh
curl https://ascii-diagram.kdawg.dev/api/diagrams \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg title "System architecture" --slurpfile spec diagram.json '{title: $title, spec: $spec[0]}')"
```

On HTTP 201, return the response's `url` to the user as a Markdown link. Preserve the entire URL, including `?token=...`. The token is the only way to open that diagram, so don't post it publicly.

On HTTP 422, fix the spec using the returned error and retry. On 429, wait a minute. Don't repeatedly retry an unchanged failing request.

Limits: 256 KiB request body, 240 × 140 cells, 16 megapixels, 30 shares per minute per IP.

Icons: use the skill's semantic shortcut IDs (for example `agent` or `datastore`) or any Tabler 3.46.0 ID such as `outline/browser` or `filled/heart`. Skip the skill's icon-fetch step; the app bundles the full catalog.
