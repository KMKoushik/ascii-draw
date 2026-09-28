import { test, expect, type Page } from "@playwright/test";
import example from "../../shared/example.json" with { type: "json" };

type Cell = [number, number];

async function grid(page: Page) {
  const canvas = page.getByLabel("Drawing canvas");
  await expect(canvas).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(50);
  const box = (await canvas.boundingBox())!;
  const cw = Number(await canvas.getAttribute("data-cell-width"));
  const rh = Number(await canvas.getAttribute("data-row-height"));
  const at = ([c, r]: Cell): Cell => [box.x + (c + 0.5) * cw, box.y + (r + 0.5) * rh];
  return {
    box, cw, rh, at,
    click: (cell: Cell) => page.mouse.click(...at(cell)),
    dblclick: (cell: Cell) => page.mouse.dblclick(...at(cell)),
    drag: async (from: Cell, to: Cell) => {
      await page.mouse.move(...at(from));
      await page.mouse.down();
      await page.mouse.move(...at(to), { steps: 6 });
      await page.mouse.up();
    },
  };
}

async function blank(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Draw", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("Pick a tool and start drawing")).toBeVisible();
  return grid(page);
}

async function currentSpec(page: Page) {
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const raw = await page.getByRole("textbox", { name: "Diagram JSON" }).inputValue();
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(page.getByLabel("Drawing canvas")).toBeVisible();
  return raw ? JSON.parse(raw) : null;
}

async function drawBox(page: Page, g: Awaited<ReturnType<typeof grid>>, from: Cell, to: Cell, title: string) {
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await g.drag(from, to);
  await page.getByLabel("Box title").fill(title);
}

test("Draw is the default; draw boxes, an arrow, text and an icon, then share", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const g = await blank(page);
  await drawBox(page, g, [2, 2], [18, 6], "CLIENT");
  await drawBox(page, g, [40, 2], [58, 6], "SERVER");
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  await g.drag([10, 4], [48, 4]);
  await expect(page.getByLabel("Arrow properties")).toBeVisible();
  await page.keyboard.press("t");
  await g.click([4, 10]);
  await page.getByLabel("Label text").fill("edge");
  await page.getByRole("button", { name: "Icon", exact: true }).click();
  await g.click([24, 10]);
  await page.getByLabel("Search icons").fill("database");
  await page.getByRole("option", { name: "outline/database", exact: true }).click();
  await page.screenshot({ path: "test-results/draw-desktop.png" });

  const spec = await currentSpec(page);
  const client = spec.boxes.find((b: { title?: string }) => b.title === "CLIENT");
  const server = spec.boxes.find((b: { title?: string }) => b.title === "SERVER");
  expect(client).toMatchObject({ x: 2, y: 2, width: 17, height: 5 });
  expect(server).toMatchObject({ x: 40, y: 2, width: 19, height: 5 });
  expect(spec.connectors).toEqual([expect.objectContaining({ from: { box: client.id, port: "right" }, to: { box: server.id, port: "left" } })]);
  expect(spec.texts).toEqual([expect.objectContaining({ x: 4, y: 10, value: "edge" })]);
  expect(spec.icons).toEqual([expect.objectContaining({ id: "outline/database", x: 24, y: 10, width: 4, height: 3 })]);

  await page.getByRole("button", { name: "Share →" }).click();
  const url = await page.getByRole("textbox", { name: "Share link" }).inputValue();
  const apiUrl = url.replace("/d/", "/api/diagrams/");
  const shared = await (await page.request.get(apiUrl)).json();
  expect(shared.spec.boxes.map((b: { title?: string }) => b.title)).toEqual(["CLIENT", "SERVER"]);
  await page.goto(url);
  await expect(page.locator("canvas")).toBeVisible();
  expect(errors).toEqual([]);
});

test("select, move, resize, delete, undo and redo", async ({ page }) => {
  const g = await blank(page);
  await drawBox(page, g, [2, 2], [16, 6], "MOVE ME");
  await g.drag([8, 4], [18, 9]);
  const handle: Cell = [g.box.x + 27 * g.cw + 2.5, g.box.y + 12 * g.rh + 2.5];
  await page.mouse.move(...handle);
  await page.mouse.down();
  await page.mouse.move(handle[0] + 4 * g.cw, handle[1] + 2 * g.rh, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("ArrowRight");
  let spec = await currentSpec(page);
  expect(spec.boxes).toEqual([expect.objectContaining({ title: "MOVE ME", x: 13, y: 7, width: 19, height: 7 })]);

  const g2 = await grid(page);
  await g2.click([20, 10]);
  await expect(page.getByLabel("Box properties")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByText("Pick a tool and start drawing")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByText("Pick a tool and start drawing")).toHaveCount(0);
  spec = await currentSpec(page);
  expect(spec.boxes).toEqual([expect.objectContaining({ title: "MOVE ME", x: 13, width: 19 })]);
  await page.getByRole("button", { name: "Redo" }).click();
  expect(await currentSpec(page)).toBeNull();
  await page.getByRole("button", { name: "Undo" }).click();
  expect((await currentSpec(page)).boxes).toHaveLength(1);
});

test("moving a box carries what's inside; partial overlaps are refused", async ({ page }) => {
  const g = await blank(page);
  await drawBox(page, g, [2, 2], [30, 10], "OUTER");
  await drawBox(page, g, [6, 4], [16, 7], "INNER");
  await drawBox(page, g, [40, 2], [56, 6], "OTHER");
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  await g.drag([10, 5], [48, 4]);
  await page.keyboard.press("Escape");

  await g.drag([25, 9], [25, 17]);
  let spec = await currentSpec(page);
  const byTitle = (title: string) => spec.boxes.find((b: { title?: string }) => b.title === title);
  expect(byTitle("OUTER")).toMatchObject({ x: 2, y: 10 });
  expect(byTitle("INNER")).toMatchObject({ x: 6, y: 12 });
  expect(spec.connectors[0].from.box).toBe(byTitle("INNER").id);

  const g2 = await grid(page);
  await g2.drag([48, 4], [28, 12]);
  await expect(page.getByRole("status").filter({ hasText: "can’t partly overlap" })).toBeVisible();
  spec = await currentSpec(page);
  expect(byTitle("OTHER")).toMatchObject({ x: 40, y: 2 });
});

test("colors, duplicate, double-click text, arrowhead toggle", async ({ page }) => {
  const g = await blank(page);
  await drawBox(page, g, [2, 2], [16, 6], "A");
  await page.getByRole("button", { name: "Color #ffd15b" }).click();
  await g.click([8, 4]);
  await page.keyboard.press("ControlOrMeta+d");
  await g.dblclick([4, 12]);
  await page.getByLabel("Label text").fill("note");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  await g.drag([8, 4], [26, 4]);
  await page.getByRole("button", { name: "Off", exact: true }).click();
  const spec = await currentSpec(page);
  expect(spec.boxes).toHaveLength(2);
  expect(spec.boxes[0].color).toBe("#ffd15b");
  expect(spec.boxes[1]).toMatchObject({ title: "A", x: 19, color: "#ffd15b" });
  expect(spec.texts).toEqual([expect.objectContaining({ x: 4, y: 12, value: "note" })]);
  expect(spec.connectors).toBeUndefined();
  expect(spec.lines).toHaveLength(1);
});

test("pasting JSON in Draw loads it; mode is remembered", async ({ page }) => {
  await blank(page);
  await page.evaluate(text => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, JSON.stringify(example));
  await expect(page.getByText("Pick a tool and start drawing")).toHaveCount(0);
  const spec = await currentSpec(page);
  expect(spec.boxes.map((b: { title: string }) => b.title)).toEqual(["AGENT", "WORKER", "BROWSER", "D1"]);
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "JSON", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Diagram JSON" })).toBeVisible();
});

test("draw mode fits on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByLabel("Drawing canvas")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Drawing tools" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/draw-mobile.png" });
});
