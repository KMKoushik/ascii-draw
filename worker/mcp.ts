import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import guide from "../shared/mcp-guide.md?raw";
import architecture from "../shared/example.json";
import requestFlow from "../shared/example-request-flow.json";
import { validateSpec, type Spec } from "../shared/spec";
import { lintSpec } from "../shared/lint";
import { friendlyError } from "../shared/geometry";
import { searchIcons } from "../shared/icons";
import { createDiagram, HttpError, rateLimit, readDiagram, type Env } from "./store";

const instructions = `ascii-diagram draws architecture diagrams as Unicode box art from a JSON spec and shares them as private links.

Workflow:
1. If you don't know the spec format yet, call diagram_guide (or read the ascii-diagram://guide resource). It covers the grid, boxes, connectors, text, icons, composition rules, layout recipes, and error fixes.
2. Draft a spec, then call render_diagram and read the ASCII it returns. Check every arrow reaches its target and nothing is cramped. Fix and re-render until it is clean and has no warnings you can reasonably address.
3. Call publish_diagram with a descriptive title, then give the user the returned url as a Markdown link. Keep the whole URL including ?token= (the token is the access key; don't post it publicly).
To change an existing diagram, call get_diagram with its link, edit the spec, render, and publish again (that gives a new link).
No authentication is needed.`;

const examples = { architecture, "request-flow": requestFlow } as Record<string, unknown>;
const specField = z.unknown().describe("The diagram spec: a JSON object (a JSON string also works) with canvas, boxes, connectors, lines, texts, icons, requiredLabels, and style. Call diagram_guide for the format.");

function text(value: string, isError = false) {
  return { content: [{ type: "text" as const, text: value }], ...(isError ? { isError: true } : {}) };
}

function parseSpec(input: unknown) {
  if (input === undefined || input === null) throw new Error("spec is required. Pass the diagram spec object.");
  if (typeof input !== "string") return input;
  try { return JSON.parse(input); } catch { throw new Error("spec is a string but not valid JSON. Pass the spec object itself."); }
}

function describe(spec: Spec) {
  const count = (list: unknown[] | undefined, noun: string) => `${list?.length ?? 0} ${noun}${list?.length === 1 ? "" : "s"}`;
  return `${spec.canvas.width}×${spec.canvas.height} cells: ${count(spec.boxes, "box").replace("boxs", "boxes")}, ${count(spec.connectors, "connector")}, ${count(spec.lines, "line")}, ${count(spec.texts, "text label")}, ${count(spec.icons, "icon")}`;
}

function report(input: unknown) {
  const { spec, diagram } = validateSpec(parseSpec(input));
  const warnings = lintSpec(spec);
  const iconNote = diagram.icons.length ? "\nIcons appear as compact marks here (<> for catalog icons). The viewer draws the real pictograms." : "";
  const body = [
    `Valid diagram (${describe(spec)}).`,
    "",
    "```text",
    diagram.text,
    "```",
    iconNote.trim(),
    warnings.length ? `\nWarnings (composition, not errors):\n${warnings.map(w => `- ${w}`).join("\n")}` : "\nNo warnings.",
  ].filter(line => line !== "").join("\n");
  return { spec, diagram, warnings, body };
}

function failure(error: unknown) {
  const message = (error as Error)?.message ?? String(error);
  const hint = friendlyError(error);
  return text(`Invalid diagram: ${message}${hint !== message ? `\nHint: ${hint}` : ""}\nSee the "Errors you will see and fixes" section of diagram_guide. Fix the spec and call render_diagram again.`, true);
}

function parseLink(link: string) {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  const id = url.pathname.match(/^\/(?:d|api\/diagrams)\/([a-f0-9-]{36})$/)?.[1];
  return id ? { id, token: url.searchParams.get("token") } : null;
}

function buildServer(env: Env, request: Request) {
  const origin = new URL(request.url).origin;
  const server = new McpServer({ name: "ascii-diagram", title: "ascii-diagram", version: "1.0.0", websiteUrl: origin }, { instructions });

  server.registerTool("diagram_guide", {
    title: "Diagram authoring guide",
    description: "How to write an ascii-diagram spec: workflow, composition rules, grid, full spec reference (boxes, connectors, lines, text, icons, requiredLabels, style), layout recipes, and fixes for every validation error. Read this before your first diagram.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => text(`${guide}\n\n## Examples\n\nWorking specs are available from the resources ascii-diagram://examples/architecture (a 2 × 2 grid with icons) and ascii-diagram://examples/request-flow (a vertical flow with a labelled side branch).\n\nArchitecture example:\n\n\`\`\`json\n${JSON.stringify(architecture)}\n\`\`\``));

  server.registerTool("render_diagram", {
    title: "Render and check a diagram",
    description: "Validates a spec with the real layout engine and returns the exact ASCII rendering, plus composition warnings. Nothing is saved. Use it to check and iterate before publishing.",
    inputSchema: z.object({ spec: specField }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ spec }) => {
    try { return text(report(spec).body); } catch (error) { return failure(error); }
  });

  server.registerTool("publish_diagram", {
    title: "Publish a diagram",
    description: "Validates and saves a spec, then returns a private share link. Anyone with the full link (including ?token=) can view it; nobody can without it. Give the user the url. Call render_diagram first to check the layout.",
    inputSchema: z.object({
      spec: specField,
      title: z.string().trim().min(1).max(160).optional().describe("Descriptive title shown on the shared page, e.g. \"Checkout architecture\". Defaults to \"Untitled diagram\"."),
      expiresAt: z.iso.datetime({ offset: true }).optional().describe("Optional ISO 8601 time when the link stops working. Omit for a permanent link."),
    }),
    outputSchema: z.object({ id: z.string(), url: z.string(), title: z.string(), createdAt: z.string(), expiresAt: z.string().nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ spec, title, expiresAt }) => {
    let checked;
    try { checked = report(spec); } catch (error) { return failure(error); }
    try {
      await rateLimit(env, request);
      const { spec: _saved, ...published } = await createDiagram(env, origin, { title: title ?? "Untitled diagram", spec: checked.spec, expiresAt });
      return {
        content: [{ type: "text" as const, text: `Published "${published.title}".\n\nLink: ${published.url}\n\nGive the user this full link, including ?token=. Anyone who has it can view the diagram.${published.expiresAt ? ` It expires at ${published.expiresAt}.` : ""}\n\n\`\`\`text\n${checked.diagram.text}\n\`\`\`` }],
        structuredContent: published,
      };
    } catch (error) {
      if (error instanceof HttpError) return text(error.status === 429 ? "Rate limited: too many diagrams published from this network. Wait a minute and try again." : error.message, true);
      throw error;
    }
  });

  server.registerTool("get_diagram", {
    title: "Open a shared diagram",
    description: "Loads a published diagram from its share link (https://…/d/<id>?token=…) and returns its title, spec, and ASCII rendering, so you can revise it and publish a new version.",
    inputSchema: z.object({ url: z.string().describe("The full share link, including ?token=") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ url }) => {
    const link = parseLink(url);
    if (!link) return text("That isn't a diagram link. Expected https://…/d/<id>?token=…", true);
    const row = await readDiagram(env, link.id, link.token);
    if (!row) return text("Diagram unavailable: the link is incomplete, expired, or revoked. Ask for the full, current link.", true);
    const spec = JSON.parse(row.spec) as Spec;
    let rendering = "";
    try { rendering = validateSpec(spec).diagram.text; } catch { /* stored specs are validated on publish */ }
    return {
      content: [{ type: "text" as const, text: `"${row.title}" (published ${row.created_at}${row.expires_at ? `, expires ${row.expires_at}` : ""})\n\n\`\`\`text\n${rendering}\n\`\`\`\n\nSpec:\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`` }],
      structuredContent: { id: row.id, title: row.title, spec, createdAt: row.created_at, expiresAt: row.expires_at },
    };
  });

  server.registerTool("search_icons", {
    title: "Search icons",
    description: "Finds icon ids for the spec's icons array: semantic shortcuts (agent, datastore, queue, …) and 6,000+ Tabler icons (outline/…, filled/…). An empty query lists common architecture icons.",
    inputSchema: z.object({
      query: z.string().max(80).describe("A word like database, server, user, github, queue. Empty for common picks."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum results (default 30)."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, limit }) => {
    const results = searchIcons(query, limit ?? 30);
    if (!results.length) return text(`No icons match "${query}". Try a broader word (e.g. "data" instead of "postgresql").`);
    return text(`${results.map(option => option.id).join("\n")}\n\nUse an id in icons[]: { "id": "${results[0].id}", "x": …, "y": …, "width": 4, "height": 3, "color": "#79bdff" }. The reserved cells must be empty.`);
  });

  server.registerResource("guide", "ascii-diagram://guide", {
    title: "Diagram authoring guide",
    description: "Spec format, composition rules, recipes, and error fixes.",
    mimeType: "text/markdown",
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide }] }));

  for (const [name, spec] of Object.entries(examples)) {
    server.registerResource(`example-${name}`, `ascii-diagram://examples/${name}`, {
      title: `Example: ${name}`,
      description: name === "architecture" ? "2 × 2 grid of boxes with icons and connectors." : "Vertical flow with a labelled side branch.",
      mimeType: "application/json",
    }, async uri => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(spec, null, 2) }] }));
  }

  server.registerPrompt("draw_diagram", {
    title: "Draw a diagram",
    description: "Create and share an ASCII architecture diagram of a system or flow.",
    argsSchema: z.object({ subject: z.string().describe("What to diagram, e.g. \"our checkout flow from cart to payment provider\"") }),
  }, ({ subject }) => ({
    messages: [{
      role: "user" as const,
      content: { type: "text" as const, text: `Create an ASCII architecture diagram of: ${subject}\n\nPlan the one-sentence claim and the common path first. Then write the spec, check it with render_diagram until the layout is clean, publish it with publish_diagram, and give me the link.\n\n${guide}` },
    }],
  }));

  return server;
}

export function mcpHandler(request: Request, env: Env, ctx: ExecutionContext) {
  return createMcpHandler(() => buildServer(env, request), { route: "/mcp" })(request, env, ctx);
}
