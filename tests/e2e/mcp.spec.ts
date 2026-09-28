import { test, expect } from "@playwright/test";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as TransportV1 } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client as ClientV2, StreamableHTTPClientTransport as TransportV2 } from "@modelcontextprotocol/client";
import example from "../../shared/example.json" with { type: "json" };

type Content = { type: string; text?: string }[];
const endpoint = (baseURL: string | undefined) => new URL("/mcp", baseURL);
const textOf = (result: { content?: unknown }) => (result.content as Content).map(item => item.text ?? "").join("\n");

async function connectV1(baseURL: string | undefined) {
  const client = new ClientV1({ name: "e2e-v1", version: "1.0.0" });
  await client.connect(new TransportV1(endpoint(baseURL)));
  return client;
}

test("a 2025-era MCP client can learn, render, publish, reopen, and search", async ({ baseURL, request }) => {
  const client = await connectV1(baseURL);
  expect(client.getServerVersion()?.name).toBe("ascii-diagram");
  const serverIcons = (client.getServerVersion() as { icons?: { src: string; mimeType: string }[] }).icons ?? [];
  expect(serverIcons.map(icon => icon.mimeType)).toContain("image/png");
  for (const icon of serverIcons) {
    const response = await request.get(icon.src);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe(icon.mimeType);
  }
  const favicon = await request.get("/favicon.ico");
  expect(favicon.headers()["content-type"]).toMatch(/icon/);
  expect(client.getInstructions()).toContain("render_diagram");

  const tools = await client.listTools();
  expect(tools.tools.map(tool => tool.name).sort()).toEqual(["diagram_guide", "get_diagram", "publish_diagram", "render_diagram", "search_icons"]);
  const publishTool = tools.tools.find(tool => tool.name === "publish_diagram")!;
  expect(publishTool.inputSchema.properties).toHaveProperty("spec");
  expect(publishTool.annotations?.readOnlyHint).toBe(false);

  const guide = textOf(await client.callTool({ name: "diagram_guide", arguments: {} }));
  expect(guide).toContain("## Spec reference");
  expect(guide).toContain("Errors you will see and fixes");

  const rendered = await client.callTool({ name: "render_diagram", arguments: { spec: example } });
  expect(rendered.isError).toBeFalsy();
  expect(textOf(rendered)).toContain("Valid diagram (76×24 cells: 4 boxes, 3 connectors");
  expect(textOf(rendered)).toContain("┌────────── AGENT ───────────┐");

  const asString = await client.callTool({ name: "render_diagram", arguments: { spec: JSON.stringify(example) } });
  expect(asString.isError).toBeFalsy();

  const overlapping = { canvas: { width: 40, height: 12 }, boxes: [
    { id: "a", x: 2, y: 2, width: 16, height: 5, title: "A" },
    { id: "b", x: 10, y: 4, width: 16, height: 5, title: "B" },
  ] };
  const broken = await client.callTool({ name: "render_diagram", arguments: { spec: overlapping } });
  expect(broken.isError).toBe(true);
  expect(textOf(broken)).toContain("Boxes overlap: a and b");
  expect(textOf(broken)).toContain("Hint:");

  const crowded = { canvas: { width: 50, height: 10 }, boxes: [
    { id: "p", x: 2, y: 2, width: 40, height: 5, lines: ["checkout · patch · boot · replay"] },
  ] };
  const warned = textOf(await client.callTool({ name: "render_diagram", arguments: { spec: crowded } }));
  expect(warned).toContain("compressed list");
  expect(warned).toContain("no title");

  const published = await client.callTool({ name: "publish_diagram", arguments: { spec: example, title: "MCP architecture" } });
  expect(published.isError).toBeFalsy();
  const { url, title } = published.structuredContent as { url: string; title: string };
  expect(title).toBe("MCP architecture");
  expect(url).toMatch(/\/d\/[a-f0-9-]{36}\?token=[A-Za-z0-9_-]{43}$/);
  expect(textOf(published)).toContain(url);
  const stored = await (await request.get(url.replace("/d/", "/api/diagrams/"))).json();
  expect(stored.spec).toEqual(example);

  const reopened = await client.callTool({ name: "get_diagram", arguments: { url } });
  expect((reopened.structuredContent as { spec: unknown }).spec).toEqual(example);
  expect(textOf(reopened)).toContain("\"MCP architecture\"");
  const tampered = await client.callTool({ name: "get_diagram", arguments: { url: url.replace(/token=./, "token=x") } });
  expect(tampered.isError).toBe(true);
  expect(textOf(tampered)).toContain("Diagram unavailable");

  const invalidPublish = await client.callTool({ name: "publish_diagram", arguments: { spec: overlapping } });
  expect(invalidPublish.isError).toBe(true);

  const icons = textOf(await client.callTool({ name: "search_icons", arguments: { query: "database" } }));
  expect(icons.split("\n")).toContain("outline/database");
  expect(icons.split("\n")).toContain("datastore");

  await client.close();
});

test("resources and the draw_diagram prompt are available", async ({ baseURL }) => {
  const client = await connectV1(baseURL);
  const resources = await client.listResources();
  expect(resources.resources.map(resource => resource.uri).sort()).toEqual([
    "ascii-diagram://examples/architecture",
    "ascii-diagram://examples/request-flow",
    "ascii-diagram://guide",
  ]);
  const flow = await client.readResource({ uri: "ascii-diagram://examples/request-flow" });
  const spec = JSON.parse((flow.contents[0] as { text: string }).text);
  const rendered = await client.callTool({ name: "render_diagram", arguments: { spec } });
  expect(rendered.isError).toBeFalsy();
  expect(textOf(rendered)).toContain("No warnings.");

  const prompts = await client.listPrompts();
  expect(prompts.prompts.map(prompt => prompt.name)).toEqual(["draw_diagram"]);
  const prompt = await client.getPrompt({ name: "draw_diagram", arguments: { subject: "a checkout flow" } });
  expect((prompt.messages[0].content as { text: string }).text).toContain("a checkout flow");
  await client.close();
});

test("a 2026-era MCP client works too", async ({ baseURL }) => {
  const client = new ClientV2({ name: "e2e-v2", version: "1.0.0" });
  await client.connect(new TransportV2(endpoint(baseURL)));
  const tools = await client.listTools();
  expect(tools.tools.length).toBe(5);
  const result = await client.callTool({ name: "render_diagram", arguments: { spec: example } });
  expect(textOf(result)).toContain("Valid diagram");
  await client.close();
});

test("the MCP endpoint rejects plain GETs and foreign browser origins", async ({ request }) => {
  expect((await request.get("/mcp")).status()).toBe(405);
  const foreign = await request.post("/mcp", {
    headers: { Origin: "https://evil.example", Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(foreign.status()).toBe(403);
});
