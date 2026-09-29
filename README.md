# ascii-diagram

Draw terminal-style ASCII diagrams and share them as links. Agents can publish them too.

**Live:** https://ascii.kdawg.dev

## Use it

**In the browser:** draw (or paste JSON), press **Share →**, and copy the link. Anyone with the link can view and edit, and edits autosave to the same link.

**From an agent over MCP:**

```sh
claude mcp add --transport http ascii-diagram https://ascii.kdawg.dev/mcp
```

Other clients: add `https://ascii.kdawg.dev/mcp` as a remote HTTP MCP server, or use `npx mcp-remote <url>` for stdio-only clients.

**Over HTTP:**

```sh
curl https://ascii.kdawg.dev/api/diagrams \
  -H 'Content-Type: application/json' \
  -d '{ "title": "System architecture", "spec": { ... } }'
```

This returns the share `url`. See [/docs](https://ascii.kdawg.dev/docs) for the API and [/spec-format.md](https://ascii.kdawg.dev/spec-format.md) for the spec.

## The skill

[`skills/ascii-diagram-png`](skills/ascii-diagram-png) lets a coding agent write diagrams and render them to PNG locally:

```sh
npx skills add KMKoushik/ascii-diagram
```

You can also copy the folder into `~/.claude/skills/` or `~/.agents/skills/`. Rendering needs ImageMagick and librsvg (`brew install imagemagick librsvg`).

## Development

```sh
npm ci
printf 'PUBLISH_API_KEY=local-test-key-not-for-production\n' > .dev.vars
npm run db:local
npm run dev
```

Tests: `npm test` and `npm run test:e2e`.

Deploy to Cloudflare Workers + D1 with `npm run db:remote`, `npx wrangler secret put PUBLISH_API_KEY`, and `npm run deploy`. For your own deployment, update the account and database IDs in `wrangler.jsonc`. `PUBLISH_API_KEY` is an admin key for rotating and revoking links.

The app's layout engine (`shared/engine.js`) is generated from the skill with `npm run sync:renderer`.

## Credits

The `ascii-diagram-png` skill and its layout engine were created by [danny (@godwhoa)](https://github.com/godwhoa). UI components are adapted from [ascii-cn](https://ascii-cn.kdawg.dev/).

## License

MIT. The skill is MIT, © danny. JetBrains Mono (OFL) and Tabler Icons (MIT) notices are in `public/licenses`.
