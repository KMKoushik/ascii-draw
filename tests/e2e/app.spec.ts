import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import example from "../../shared/example.json" with { type: "json" };

const localKey = "local-test-key-not-for-production";
const admin = { Authorization: `Bearer ${localKey}` };
const exampleFile = { name: "agent-to-browser.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(example)) };
const iconSpec = { canvas: { width: 50, height: 16 }, boxes: [], texts: [{ y: 0, value: "HYBRID ICONS" }], icons: [
  { id: "agent", x: 3, y: 4, width: 5, height: 3, color: "#79bdff" },
  { id: "outline/browser", x: 15, y: 4, width: 5, height: 3, color: "#ffd15b" },
  { id: "filled/heart", x: 28, y: 4, width: 5, height: 3, color: "#ff9d91" },
] };

async function publish(request: APIRequestContext, extra = {}) {
  const response = await request.post("/api/diagrams", { data: { title: "Private test diagram", spec: example, ...extra } });
  expect(response.status()).toBe(201);
  return await response.json() as { id: string; url: string };
}
function apiUrl(url: string) { const result = new URL(url); result.pathname = result.pathname.replace("/d/", "/api/diagrams/"); return result.href; }
async function openJson(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
}
async function iconPixels(page: import("@playwright/test").Page) {
  return page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext("2d")!.getImageData(0, 150, canvas.width, canvas.height - 150);
    return Array.from(data).filter((v, i) => i % 4 !== 3 && v > 50).length;
  });
}

test("publishing needs no auth; input validation fails closed", async ({ request }) => {
  const response = await request.post("/api/diagrams", { data: { title: "No auth", spec: example } });
  expect(response.status()).toBe(201);
  expect((await request.post("/api/diagrams", { data: { title: "Bad canvas", spec: { canvas: { width: 1e9, height: 100 } } } })).status()).toBe(422);
  expect((await request.post("/api/diagrams", { data: { title: "Expired", spec: example, expiresAt: "2000-01-01T00:00:00Z" } })).status()).toBe(400);
  expect((await request.post("/api/diagrams", { headers: { "Content-Type": "text/plain" }, data: "{}" })).status()).toBe(415);
  expect((await request.post("/api/diagrams", { data: { title: "Too large", spec: "x".repeat(270000) } })).status()).toBe(413);
});

test("title is optional in the API", async ({ request }) => {
  const response = await request.post("/api/diagrams", { data: { spec: example } });
  expect(response.status()).toBe(201);
  expect((await response.json()).title).toBe("Untitled diagram");
});

test("complete link is required for HTML and JSON, tokens are diagram scoped", async ({ request, page }) => {
  const first = await publish(request);
  const second = await publish(request);
  const allowed = await request.get(apiUrl(first.url));
  expect(allowed.status()).toBe(200);
  expect((await allowed.json()).spec).toEqual(example);
  expect(allowed.headers()["cache-control"]).toBe("no-store");
  expect(allowed.headers()["referrer-policy"]).toBe("no-referrer");
  const bad = new URL(second.url);
  bad.search = new URL(first.url).search;
  for (const url of [`/d/${first.id}`, `/api/diagrams/${first.id}`, bad.href, apiUrl(bad.href)]) expect((await request.get(url)).status()).toBe(404);
  const loaded = await page.goto(`/d/${first.id}`);
  expect(loaded?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "You need the full link." })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.getByText("Private test diagram", { exact: true })).toHaveCount(0);
});

test("rotation and revocation invalidate both HTML and JSON immediately", async ({ request }) => {
  const original = await publish(request);
  expect((await request.post(`/api/diagrams/${original.id}/rotate-token`)).status()).toBe(401);
  const rotated = await (await request.post(`/api/diagrams/${original.id}/rotate-token`, { headers: admin })).json();
  expect(rotated.url).not.toBe(original.url);
  expect((await request.get(original.url)).status()).toBe(404);
  expect((await request.get(apiUrl(original.url))).status()).toBe(404);
  expect((await request.get(rotated.url)).status()).toBe(200);
  expect((await request.get(apiUrl(rotated.url))).status()).toBe(200);
  expect((await request.post(`/api/diagrams/${original.id}/revoke`, { headers: admin })).status()).toBe(200);
  expect((await request.get(rotated.url)).status()).toBe(404);
  expect((await request.get(apiUrl(rotated.url))).status()).toBe(404);
});

test("expired links deny future reads", async ({ request }) => {
  const created = await publish(request, { expiresAt: new Date(Date.now() + 1200).toISOString() });
  expect((await request.get(apiUrl(created.url))).status()).toBe(200);
  await expect.poll(async () => (await request.get(apiUrl(created.url))).status(), { timeout: 5000 }).toBe(404);
  expect((await request.get(created.url)).status()).toBe(404);
});

test("paste/edit, share, copy: no key, edits need a new share", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openJson(page);
  const editor = page.getByRole("textbox", { name: "Diagram JSON" });
  await expect(editor).toHaveValue(/"canvas"/);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Architecture");
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(() => iconPixels(page)).toBeGreaterThan(50);
  await editor.fill(JSON.stringify(example));
  await page.getByRole("button", { name: "Format" }).click();
  await expect(editor).toHaveValue(JSON.stringify(example, null, 2));
  await page.getByRole("textbox", { name: "Title" }).fill("Agent to browser");
  await page.getByRole("button", { name: "Share →" }).click();
  const link = page.getByRole("textbox", { name: "Share link" });
  await expect(link).toHaveValue(/\/d\/[a-f0-9-]{36}\?token=[A-Za-z0-9_-]{43}$/);
  const url = await link.inputValue();
  await expect(page.getByRole("button", { name: "Copied ✓" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await expect(page.getByText(/publishing key/i)).toHaveCount(0);

  const edited = { ...example, texts: [...example.texts, { x: 40, y: 22, value: "EDITED", color: "#ffd15b" }] };
  await editor.fill(JSON.stringify(edited, null, 2));
  await page.getByRole("button", { name: "Share again →" }).click();
  await expect(link).toBeVisible();
  await expect(link).not.toHaveValue(url);
  const editedUrl = await link.inputValue();

  await page.goto(url);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent to browser" })).toBeVisible();
  const pngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  const bytes = await readFile((await (await pngPromise).path())!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(500);
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(300);
  const jsonPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  expect(JSON.parse(await readFile((await (await jsonPromise).path())!, "utf8"))).toEqual(example);
  const shared = await (await page.request.get(apiUrl(editedUrl))).json();
  expect(shared.spec).toEqual(edited);
  expect(errors).toEqual([]);
});

test("upload fills the editor and title; invalid JSON blocks sharing", async ({ page }) => {
  await openJson(page);
  await page.getByLabel("Diagram JSON file").setInputFiles(exampleFile);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("agent to browser");
  await expect(page.getByRole("textbox", { name: "Diagram JSON" })).toHaveValue(JSON.stringify(example));
  await page.getByRole("textbox", { name: "Diagram JSON" }).fill("{ broken");
  await expect(page.getByText("[ invalid ]")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Invalid JSON");
  await expect(page.getByRole("button", { name: "Share →" })).toBeDisabled();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("Paste diagram JSON on the left.")).toBeVisible();
});

test("icons render in the editor preview, the shared view, and the PNG", async ({ page, request }) => {
  await openJson(page);
  await page.getByRole("textbox", { name: "Diagram JSON" }).fill(JSON.stringify(iconSpec, null, 2));
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(() => iconPixels(page)).toBeGreaterThan(50);

  const created = await publish(request, { spec: iconSpec });
  await page.goto(created.url);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("link", { name: "Icon license" })).toBeVisible();
  await expect.poll(() => iconPixels(page)).toBeGreaterThan(50);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});

test("mobile layout fits through the whole flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Share →" }).click();
  await expect(page.getByRole("textbox", { name: "Share link" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mobile-shared.png", fullPage: true });
  await page.getByRole("link", { name: "API" }).click();
  await expect(page.getByRole("heading", { name: "API", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("desktop screens have a clean console and fit the viewport", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", e => { if (e.type() === "error") errors.push(e.text()); });
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/desktop-draw.png", fullPage: true });
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-editor.png", fullPage: true });
  await page.getByRole("button", { name: "Share →" }).click();
  await expect(page.getByRole("textbox", { name: "Share link" })).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-shared.png", fullPage: true });
  await page.goto((await publish(request)).url);
  await expect(page.locator("canvas")).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-viewer.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("publishing is rate limited per client", async ({ request }) => {
  let status = 0;
  for (let i = 0; i < 40 && status !== 429; i++) {
    status = (await request.post("/api/diagrams", { headers: { "CF-Connecting-IP": "10.255.255.254" }, data: { spec: example } })).status();
  }
  expect(status).toBe(429);
  expect((await request.post("/api/diagrams", { data: { spec: example } })).status()).toBe(201);
});
