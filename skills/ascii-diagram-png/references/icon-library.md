# Terminal Icon Library

The skill exposes the full [Tabler Icons 3.46.0](https://github.com/tabler/tabler-icons/releases/tag/v3.46.0) catalog: 5,130 outline icons and 1,054 filled icons. Only the searchable index and 39 semantic shortcut vectors are bundled. Extra vectors are fetched on demand under the [MIT license](../assets/TABLER-ICONS-LICENSE.txt).

## Search the full catalog

Search [tabler-catalog.tsv](tabler-catalog.tsv) by icon name or category; do not load the full vector JSON into context:

```sh
rg -i 'browser|whatsapp|calendar|mail|brand-google' <skill-directory>/references/tabler-catalog.tsv
```

Use the exact ID in a root `icons` reservation, for example `outline/browser`, `outline/brand-whatsapp`, or `filled/heart`. Select icons before layout so each has enough space. Prefer outline for a consistent architecture diagram; choose filled when the intended style calls for it.

The 39 semantic shortcuts below still work, including `agent`, `model`, and `datastore`. They are convenient choices, not a limit on the available catalog. Their canonical text data remains in [icon-library.json](icon-library.json), with a specimen at [../assets/icon-library.png](../assets/icon-library.png). Full-catalog IDs use `<>` as a neutral plain-text placeholder; the adjacent label carries the meaning. Their PNGs use the actual SVG icon.

## Fetch only selected icons

After writing the specification, fetch its catalog icons:

```sh
node <skill-directory>/scripts/fetch_tabler_icons.mjs <spec.json>
node <skill-directory>/scripts/render_ascii_diagram.mjs <spec.json> --output <output-base>
```

The helper reads the specification and downloads only its `outline/...` and `filled/...` icons from the pinned official `@tabler/icons` npm package through jsDelivr. Semantic shortcuts need no download. Cache files live outside the skill at `~/.cache/ascii-diagram-png/tabler/3.46.0/`. Rendering itself does not access the network. Cached icons work offline; a missing icon produces an explicit preparation error.

For a task-owned writable cache, set `TABLER_ICON_CACHE` to the same absolute directory for both commands. Keep that cache with the diagram if it must render offline on another machine. Do not copy the full catalog into the skill or diagram output.

## Usage

- Use an SVG pictogram for each major node in PNG output and keep the compact `mark` in plain text. Icons are required unless the user explicitly requests otherwise.
- Use the three-row `art` badge only for ASCII-only diagrams with enough room.
- Keep a text label with every icon. The icon supplements the label; it does not replace it.
- Use one form in one diagram. Do not mix compact marks and full badges at the same hierarchy level.
- Use `fallbackMark` when the output must work without JetBrains Mono.
- Reuse an alias from the catalog instead of creating a second icon for the same concept.
- Keep color semantic. Use the category color as a starting point, but preserve any established palette in the target diagram.
- Do not use emoji, variation selectors, private-use icons, or Nerd Font glyphs.

## Semantic shortcuts

| Category | ID | Mark | ASCII fallback | Tabler source | Common aliases |
|---|---|---:|---:|---|---|
| Compute and agents | `function` | `ƒx` | `fx` | `lambda` | lambda, fx, serverless-function |
| Compute and agents | `worker` | `⊛` | `W*` | `cpu` | job-runner, consumer, compute-worker |
| Compute and agents | `agent` | `⍟` | `A*` | `robot` | ai-agent, pi-agent, bot |
| Compute and agents | `sandbox` | `⎕` | `[]` | `box` | container, vm, modal-sandbox |
| Compute and agents | `workflow` | `WF` | `WF` | `route` | pipeline, orchestrator, dag |
| Compute and agents | `model` | `LLM` | `LLM` | `brain` | llm, inference-model |
| Compute and agents | `tool` | `+` | `+` | `tool` | tool-call, action |
| Compute and agents | `prompt` | `>_` | `>_` | `message-code` | instruction, system-prompt |
| Flow and control | `queue` | `⋯▸` | `...>` | `queue-pop-in` | job-queue, message-queue, sqs |
| Flow and control | `stream` | `⤖` | `>>>` | `waves-electricity` | event-stream, kinesis, kafka |
| Flow and control | `event` | `✶` | `*` | `bolt` | message, trigger |
| Flow and control | `scheduler` | `◔` | `T+` | `clock` | cron, timer |
| Flow and control | `branch` | `Y` | `Y` | `git-branch` | route-split, fork, decision |
| Flow and control | `retry` | `↻` | `R+` | `refresh` | refresh, retry-loop |
| Flow and control | `smoke-test` | `✓` | `OK` | `test-pipe` | health-check, validation |
| Flow and control | `publish` | `↑` | `UP` | `cloud-upload` | upload, release |
| Storage and artifacts | `datastore` | `⌸` | `DB` | `database` | database, db, sql |
| Storage and artifacts | `object-store` | `⌺` | `OBJ` | `bucket` | blob-store, bucket, s3, aws-s3 |
| Storage and artifacts | `cache` | `RAM` | `RAM` | `database-cog` | redis, memory-store |
| Storage and artifacts | `snapshot` | `⊡` | `[.]` | `layers-linked` | image, checkpoint, sandbox-snapshot |
| Storage and artifacts | `repository` | `GIT` | `GIT` | `folder-code` | repo, source-code |
| Storage and artifacts | `artifact` | `PKG` | `PKG` | `package` | build-artifact, package |
| Storage and artifacts | `harness` | `{}` | `{}` | `brackets-contain` | runnable-harness, agent-harness |
| Storage and artifacts | `install` | `IN` | `IN` | `package-import` | setup, bootstrap |
| Integration | `api` | `API` | `API` | `api` | endpoint, service-api, http-api |
| Integration | `bridge` | `⟷` | `<->` | `ai-gateway` | tool-bridge, gateway |
| Integration | `proxy` | `⇄` | `PXY` | `arrows-exchange` | tool-proxy, side-effect-proxy |
| Integration | `webhook` | `WH` | `WH` | `webhook` | hook, callback |
| Integration | `git-push` | `GH` | `GH` | `brand-github` | github-push, source-event |
| Integration | `pull-request` | `PR` | `PR` | `git-pull-request` | pr, github-pr |
| Integration | `secret` | `KEY` | `KEY` | `key` | credential, token, key |
| Observe and verify | `trace` | `o-o` | `o-o` | `scan-traces` | telemetry, span, live-trace |
| Observe and verify | `replay` | `⎋` | `<-` | `repeat` | rerun, trace-replay |
| Observe and verify | `logs` | `LOG` | `LOG` | `logs` | log, logging |
| Observe and verify | `metrics` | `∿` | `~` | `chart-line` | metric, chart |
| Observe and verify | `alert` | `!` | `!` | `alert-triangle` | warning, incident |
| Observe and verify | `success` | `OK+` | `OK+` | `circle-check` | pass, passed, ready |
| Observe and verify | `failure` | `×` | `X` | `circle-x` | fail, failed, error |
| Observe and verify | `evaluation` | `EVAL` | `EVAL` | `flask` | eval, evaluator, test |

## Validate and render the specimen

```sh
node <skill-directory>/scripts/render_icon_library.mjs --output <absolute-output-base>
node <skill-directory>/scripts/render_icon_library.mjs --output <absolute-output-base> --check
```

The script validates IDs, aliases, dimensions, character safety, category references, and SVG availability. It delegates final text and PNG output to the main diagram renderer.
