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
  await expect(page.getByLabel("Box title")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Escape");
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
  await page.keyboard.type("edge");
  await page.keyboard.press("Escape");
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
  await page.keyboard.type("note");
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

test("type straight into boxes: body, new lines, Tab to title, Text tool inside a box", async ({ page }) => {
  const g = await blank(page);
  await drawBox(page, g, [2, 2], [30, 8], "API");
  await g.dblclick([10, 5]);
  await expect(page.getByLabel("Box text")).toBeFocused();
  await page.keyboard.type("Handles requests");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Checks auth");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByLabel("Box title")).toBeFocused();
  await page.keyboard.type(" v2");
  await page.keyboard.press("Escape");

  await drawBox(page, g, [40, 2], [60, 6], "DB");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await g.click([48, 4]);
  await page.keyboard.type("Postgres");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "test-results/draw-typing.png" });

  const spec = await currentSpec(page);
  expect(spec.boxes[0]).toMatchObject({ title: "API v2", lines: ["Handles requests", "Checks auth"] });
  expect(spec.boxes[1]).toMatchObject({ title: "DB", lines: ["Postgres"] });
  expect(spec.texts).toBeUndefined();
});

test("free text goes exactly where you click, and multi-line labels stack", async ({ page }) => {
  const g = await blank(page);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await g.click([7, 3]);
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second");
  await page.keyboard.press("Escape");
  await g.dblclick([20, 9]);
  await page.keyboard.type("elsewhere");
  await page.keyboard.press("Escape");
  await g.dblclick([9, 3]);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  const spec = await currentSpec(page);
  expect(spec.texts).toEqual([
    expect.objectContaining({ x: 7, y: 3, value: "frst" }),
    expect.objectContaining({ x: 7, y: 4, value: "second" }),
    expect.objectContaining({ x: 20, y: 9, value: "elsewhere" }),
  ]);
});

test("moving snaps into line with other elements; Alt skips snapping", async ({ page }) => {
  const g = await blank(page);
  await drawBox(page, g, [2, 2], [22, 6], "BOX");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await g.click([30, 10]);
  await page.keyboard.type("hello");
  await page.keyboard.press("Escape");
  await page.mouse.move(...g.at([31, 10]));
  await page.mouse.down();
  await page.mouse.move(...g.at([12, 10]), { steps: 6 });
  await page.screenshot({ path: "test-results/draw-snap.png" });
  await page.mouse.up();
  let spec = await currentSpec(page);
  expect(spec.texts[0]).toMatchObject({ x: 10, y: 10 });

  const g2 = await grid(page);
  await page.keyboard.down("Alt");
  await page.mouse.move(...g2.at([11, 10]));
  await page.mouse.down();
  await page.mouse.move(...g2.at([12, 14]), { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  spec = await currentSpec(page);
  expect(spec.texts[0]).toMatchObject({ x: 11, y: 14 });
});

test("typing never scrolls the canvas; labels land where clicked", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Clear" }).click();
  const canvas = page.getByLabel("Drawing canvas");
  await page.evaluate(() => document.fonts.ready);
  const b = (await canvas.boundingBox())!;
  const cw = +(await canvas.getAttribute("data-cell-width"))!, rh = +(await canvas.getAttribute("data-row-height"))!;
  const at = (c: number, r: number): [number, number] => [b.x + (c + .5) * cw, b.y + (r + .5) * rh];
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await page.mouse.move(...at(2, 2)); await page.mouse.down(); await page.mouse.move(...at(30, 8), { steps: 4 }); await page.mouse.up();
  await page.keyboard.type("WORKER");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Runs jobs");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.mouse.click(...at(40, 4));
  await page.keyboard.type("free label");
  await page.waitForTimeout(80);
  expect(await page.locator(".draw-scroll").evaluate(e => e.scrollTop)).toBe(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const spec = JSON.parse(await page.getByRole("textbox", { name: "Diagram JSON" }).inputValue());
  expect(spec.texts[0]).toMatchObject({ x: 40, y: 4, value: "free label" });
});

test("editing never shifts the page; Home/End move within the line", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByLabel("Drawing canvas");
  await canvas.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const b = (await canvas.boundingBox())!;
  const cw = +(await canvas.getAttribute("data-cell-width"))!, rh = +(await canvas.getAttribute("data-row-height"))!;
  const at = (c: number, r: number): [number, number] => [b.x + (c + .5) * cw, b.y + (r + .5) * rh];
  const top = async () => (await canvas.boundingBox())!.y;
  await page.mouse.dblclick(...at(10, 8)); await page.keyboard.press("End"); await page.keyboard.type(" now"); await page.keyboard.press("Escape");
  await page.mouse.dblclick(...at(58, 6)); await page.keyboard.press("End"); await page.keyboard.type(" 2"); await page.keyboard.press("Escape");
  expect(await top()).toBe(b.y);
  await page.mouse.dblclick(...at(80, 3)); await page.keyboard.type("typed on canvas"); await page.keyboard.press("Escape");
  expect(await top()).toBe(b.y);
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const spec = JSON.parse(await page.getByRole("textbox", { name: "Diagram JSON" }).inputValue());
  expect(spec.texts).toContainEqual(expect.objectContaining({ x: 80, y: 3, value: "typed on canvas" }));
  expect(spec.boxes[1].title).toBe("WORKER 2");
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  const g = (await page.getByLabel("Drawing canvas").boundingBox())!;
  await page.mouse.dblclick(g.x + (80.5 + 3) * cw, g.y + 3.5 * rh);
  await page.keyboard.press("Home");
  await page.keyboard.type("> ");
  await page.keyboard.press("Shift+End");
  await page.keyboard.type("done");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const after = JSON.parse(await page.getByRole("textbox", { name: "Diagram JSON" }).inputValue());
  expect(after.texts).toContainEqual(expect.objectContaining({ x: 80, y: 3, value: "> done" }));
  expect((await page.getByLabel("Drawing canvas").count())).toBe(0);
});
