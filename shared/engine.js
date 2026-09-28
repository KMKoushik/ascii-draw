// Generated from ascii-diagram-png by scripts/sync-renderer.mjs.
import iconLibrary from './icon-library.json';
import iconIds from './icon-catalog.json';
const catalog = new Set(iconIds);
const NORTH = 1;
const EAST = 2;
const SOUTH = 4;
const WEST = 8;

const lineGlyphs = new Map([
  [NORTH, "│"],
  [EAST, "─"],
  [SOUTH, "│"],
  [WEST, "─"],
  [NORTH | SOUTH, "│"],
  [EAST | WEST, "─"],
  [EAST | SOUTH, "┌"],
  [SOUTH | WEST, "┐"],
  [NORTH | EAST, "└"],
  [NORTH | WEST, "┘"],
  [NORTH | EAST | SOUTH, "├"],
  [EAST | SOUTH | WEST, "┬"],
  [NORTH | EAST | WEST, "┴"],
  [NORTH | SOUTH | WEST, "┤"],
  [NORTH | EAST | SOUTH | WEST, "┼"],
]);

const arrowGlyphs = new Map([
  ["north", "▲"],
  ["east", "▶"],
  ["south", "▼"],
  ["west", "◀"],
]);

const arrowTravelOffsets = new Map([
  ["north", [0, -1]],
  ["east", [1, 0]],
  ["south", [0, 1]],
  ["west", [-1, 0]],
]);

const arrowIncomingMasks = new Map([
  ["north", SOUTH],
  ["east", WEST],
  ["south", NORTH],
  ["west", EAST],
]);

const arrowIncomingMasksByGlyph = new Map(
  [...arrowGlyphs].map(([direction, glyph]) => [glyph, arrowIncomingMasks.get(direction)]),
);

const oppositeDirection = new Map([
  [NORTH, SOUTH],
  [EAST, WEST],
  [SOUTH, NORTH],
  [WEST, EAST],
]);

const directionOffsets = new Map([
  [NORTH, [0, -1]],
  [EAST, [1, 0]],
  [SOUTH, [0, 1]],
  [WEST, [-1, 0]],
]);

function displayWidth(value) {
  return [...value].length;
}

function assertInteger(value, name, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
}

function assertString(value, name) {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }

  if (value.includes("\n") || value.includes("\t") || value.includes("\u001B")) {
    throw new Error(`${name} cannot contain newlines, tabs, or ANSI escapes`);
  }
}

function assertColor(value, name) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${name} must be a six-digit hexadecimal color`);
  }
}

function optionalColor(value, name) {
  if (value === undefined) {
    return null;
  }

  assertColor(value, name);
  return value.toLowerCase();
}

function assertFiniteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

function validateSvgElement(element, name) {
  if (!element || typeof element !== "object" || Array.isArray(element)) {
    throw new Error(`${name} must be an object`);
  }

  for (const paint of ["fill", "stroke"]) {
    if (element[paint] !== undefined && !["none", "currentColor"].includes(element[paint])) {
      throw new Error(`${name}.${paint} must be none or currentColor`);
    }
  }
  if (element.opacity !== undefined) {
    assertFiniteNumber(element.opacity, `${name}.opacity`);
    if (element.opacity < 0 || element.opacity > 1) {
      throw new Error(`${name}.opacity must be between zero and one`);
    }
  }

  const numericAttributes = {
    circle: ["cx", "cy", "r"],
    line: ["x1", "y1", "x2", "y2"],
    rect: ["x", "y", "width", "height"],
  };

  if (Object.hasOwn(numericAttributes, element.type)) {
    for (const attribute of numericAttributes[element.type]) {
      assertFiniteNumber(element[attribute], `${name}.${attribute}`);
    }

    if (element.type === "circle" && element.r <= 0) {
      throw new Error(`${name}.r must be greater than zero`);
    }

    if (element.type === "rect") {
      if (element.width <= 0 || element.height <= 0) {
        throw new Error(`${name} width and height must be greater than zero`);
      }

      if (element.rx !== undefined) {
        assertFiniteNumber(element.rx, `${name}.rx`);
      }
    }

    return;
  }

  if (element.type === "path") {
    assertString(element.d, `${name}.d`);

    if (!element.d) {
      throw new Error(`${name}.d cannot be empty`);
    }

    return;
  }

  if (element.type === "polyline") {
    assertString(element.points, `${name}.points`);

    if (!element.points) {
      throw new Error(`${name}.points cannot be empty`);
    }

    return;
  }

  throw new Error(`${name}.type is not a supported SVG primitive: ${element.type}`);
}


function loadSvgIconLibrary() { return iconLibrary; }
function loadCatalogIcon(id) {
  if (!catalog.has(id)) throw new Error('Unknown SVG icon: ' + id);
  return { mark: '<>', variant: id.split('/')[0], asset: '/icons/' + id + '.svg' };
}
class TerminalCanvas {
  constructor(width, height) {
    assertInteger(width, "canvas.width", 4);
    assertInteger(height, "canvas.height", 3);
    this.width = width;
    this.height = height;
    this.masks = Array.from({ length: height }, () => Array(width).fill(0));
    this.maskColors = Array.from({ length: height }, () => Array(width).fill(null));
    this.characters = Array.from({ length: height }, () => Array(width).fill(null));
    this.characterColors = Array.from({ length: height }, () => Array(width).fill(null));
  }

  assertPoint(x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new Error(`Point is outside the ${this.width}x${this.height} canvas: ${x},${y}`);
    }
  }

  addConnection(x1, y1, direction1, x2, y2, direction2, color) {
    this.assertPoint(x1, y1);
    this.assertPoint(x2, y2);
    this.masks[y1][x1] |= direction1;
    this.masks[y2][x2] |= direction2;
    this.maskColors[y1][x1] = color;
    this.maskColors[y2][x2] = color;
  }

  segment(x1, y1, x2, y2, color = null) {
    this.assertPoint(x1, y1);
    this.assertPoint(x2, y2);

    if (x1 !== x2 && y1 !== y2) {
      throw new Error(`Only orthogonal segments are supported: ${x1},${y1} -> ${x2},${y2}`);
    }

    if (y1 === y2) {
      const start = Math.min(x1, x2);
      const end = Math.max(x1, x2);

      for (let x = start; x < end; x += 1) {
        this.addConnection(x, y1, EAST, x + 1, y1, WEST, color);
      }

      return;
    }

    const start = Math.min(y1, y2);
    const end = Math.max(y1, y2);

    for (let y = start; y < end; y += 1) {
      this.addConnection(x1, y, SOUTH, x1, y + 1, NORTH, color);
    }
  }

  polyline(points, color = null) {
    if (!Array.isArray(points) || points.length < 2) {
      throw new Error("A polyline needs at least two points");
    }

    for (let index = 1; index < points.length; index += 1) {
      const [x1, y1] = points[index - 1];
      const [x2, y2] = points[index];
      this.segment(x1, y1, x2, y2, color);
    }
  }

  text(x, y, value, { color = null, overlay = false } = {}) {
    assertString(value, "text value");
    this.assertPoint(x, y);
    const characters = [...value];

    if (x + characters.length > this.width) {
      throw new Error(`Text exceeds the canvas at ${x},${y}: ${value}`);
    }

    for (const [offset, character] of characters.entries()) {
      const cellX = x + offset;
      const existing = this.characters[y][cellX];

      if (existing !== null && existing !== character) {
        throw new Error(`Text collision at ${cellX},${y}: ${existing} vs ${character}`);
      }

      if (!overlay && this.masks[y][cellX] !== 0) {
        throw new Error(`Text crosses a line at ${cellX},${y}: ${value}`);
      }

      this.characters[y][cellX] = character;
      this.characterColors[y][cellX] = color;
    }
  }

  arrow(x, y, direction, color = null) {
    const glyph = arrowGlyphs.get(direction);

    if (!glyph) {
      throw new Error(`Unknown arrow direction: ${direction}`);
    }

    this.assertPoint(x, y);
    const mask = this.masks[y][x];
    const expectedMask = arrowIncomingMasks.get(direction);

    if (mask !== 0 && mask !== expectedMask) {
      throw new Error(`${direction} arrow at ${x},${y} does not have a clean incoming stem`);
    }

    this.text(x, y, glyph, { color, overlay: true });
  }

  box({
    x,
    y,
    width,
    height,
    title = "",
    lines = [],
    align = "center",
    borderColor = null,
    textColor = null,
    titleAlign = "center",
    titleColor = null,
  }) {
    assertInteger(width, "box width", 4);
    assertInteger(height, "box height", 3);
    this.assertPoint(x, y);
    this.assertPoint(x + width - 1, y + height - 1);

    this.segment(x, y, x + width - 1, y, borderColor);
    this.segment(x, y + height - 1, x + width - 1, y + height - 1, borderColor);
    this.segment(x, y, x, y + height - 1, borderColor);
    this.segment(x + width - 1, y, x + width - 1, y + height - 1, borderColor);

    if (title) {
      const caption = ` ${title} `;
      const captionWidth = displayWidth(caption);

      if (captionWidth > width - 2) {
        throw new Error(`Box title is too wide at ${x},${y}: ${title}`);
      }

      const titleX = titleAlign === "left" ? x + 2 : x + Math.floor((width - captionWidth) / 2);
      this.text(titleX, y, caption, { color: titleColor, overlay: true });
    }

    const interiorRows = height - 2;

    if (lines.length > interiorRows) {
      throw new Error(`Box content is too tall at ${x},${y}`);
    }

    const firstRow = y + 1 + Math.floor((interiorRows - lines.length) / 2);

    for (const [index, line] of lines.entries()) {
      const lineWidth = displayWidth(line);

      if (lineWidth > width - 4) {
        throw new Error(`Box content is too wide at ${x},${y}: ${line}`);
      }

      const lineX = align === "left" ? x + 2 : x + Math.floor((width - lineWidth) / 2);
      this.text(lineX, firstRow + index, line, { color: textColor });
    }
  }

  validate() {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const mask = this.masks[y][x];

        if (mask !== 0 && !lineGlyphs.has(mask)) {
          throw new Error(`No glyph exists for line mask ${mask} at ${x},${y}`);
        }

        const arrowExpectedMask = arrowIncomingMasksByGlyph.get(this.characters[y][x]);

        if (arrowExpectedMask !== undefined && mask !== 0 && mask !== arrowExpectedMask) {
          throw new Error(`Arrow at ${x},${y} does not terminate a clean incoming stem`);
        }

        for (const [direction, [dx, dy]] of directionOffsets) {
          if ((mask & direction) === 0) {
            continue;
          }

          const neighborX = x + dx;
          const neighborY = y + dy;
          this.assertPoint(neighborX, neighborY);
          const neighborMask = this.masks[neighborY][neighborX];

          if ((neighborMask & oppositeDirection.get(direction)) === 0) {
            throw new Error(`Line is not reciprocal between ${x},${y} and ${neighborX},${neighborY}`);
          }
        }
      }
    }
  }

  render() {
    this.validate();
    const rows = this.masks.map((row, y) =>
      row.map((mask, x) => {
        const character = this.characters[y][x];

        if (character !== null) {
          return { color: this.characterColors[y][x], glyph: character };
        }

        return { color: this.maskColors[y][x], glyph: lineGlyphs.get(mask) ?? " " };
      }),
    );

    while (rows.length > 0 && rows.at(-1).every((cell) => cell.glyph === " ")) {
      rows.pop();
    }

    const textRows = rows.map((row) => row.map((cell) => cell.glyph).join("").trimEnd());
    const renderedWidth = Math.max(0, ...textRows.map(displayWidth));

    return {
      cells: rows.map((row) => row.slice(0, renderedWidth)),
      text: textRows.join("\n"),
    };
  }
}

function normalizeLines(value, name) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }

  return value.map((line, index) => {
    assertString(line, `${name}[${index}]`);
    return line;
  });
}

function measureBox(operation) {
  const title = operation.title ?? "";
  const lines = normalizeLines(operation.lines, `${operation.id ?? "box"}.lines`);
  const color = optionalColor(operation.color, `${operation.id ?? "box"}.color`);
  const borderColor = optionalColor(operation.borderColor, `${operation.id ?? "box"}.borderColor`) ?? color;
  const textColor = optionalColor(operation.textColor, `${operation.id ?? "box"}.textColor`);
  const titleColor = optionalColor(operation.titleColor, `${operation.id ?? "box"}.titleColor`) ?? color;
  assertString(title, `${operation.id ?? "box"}.title`);
  const requiredWidth = Math.max(4, title ? displayWidth(title) + 4 : 4, ...lines.map((line) => displayWidth(line) + 4));
  const requiredHeight = Math.max(3, lines.length + 2);
  const width = Math.max(operation.width ?? 0, requiredWidth);
  const height = Math.max(operation.height ?? 0, requiredHeight);
  assertInteger(width, `${operation.id ?? "box"}.width`, 4);
  assertInteger(height, `${operation.id ?? "box"}.height`, 3);

  let x;

  if (operation.x !== undefined) {
    assertInteger(operation.x, `${operation.id ?? "box"}.x`);
    x = operation.x;
  } else if (operation.centerX !== undefined) {
    assertInteger(operation.centerX, `${operation.id ?? "box"}.centerX`);
    x = operation.centerX - Math.floor((width - 1) / 2);
  } else {
    throw new Error(`${operation.id ?? "box"} needs x or centerX`);
  }

  assertInteger(operation.y, `${operation.id ?? "box"}.y`);

  return {
    align: operation.align ?? "center",
    borderColor,
    height,
    id: operation.id,
    lines,
    textColor,
    title,
    titleAlign: operation.titleAlign ?? "center",
    titleColor,
    width,
    x,
    y: operation.y,
  };
}

function rectanglesOverlap(first, second) {
  return !(
    first.x + first.width - 1 < second.x ||
    second.x + second.width - 1 < first.x ||
    first.y + first.height - 1 < second.y ||
    second.y + second.height - 1 < first.y
  );
}

function rectangleContains(outer, inner) {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width - 1 >= inner.x + inner.width - 1 &&
    outer.y + outer.height - 1 >= inner.y + inner.height - 1
  );
}

function validateBoxPlacement(boxes) {
  for (let firstIndex = 0; firstIndex < boxes.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < boxes.length; secondIndex += 1) {
      const first = boxes[firstIndex];
      const second = boxes[secondIndex];

      if (rectanglesOverlap(first, second) && !rectangleContains(first, second) && !rectangleContains(second, first)) {
        throw new Error(`Boxes overlap: ${first.id ?? firstIndex} and ${second.id ?? secondIndex}`);
      }
    }
  }
}

function normalizeIconPlacements(value, canvas) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("icons must be an array");
  }

  const library = { icons: { ...loadSvgIconLibrary().icons } };
  const placements = value.map((operation, index) => {
    const name = `icons[${index}]`;

    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      throw new Error(`${name} must be an object`);
    }

    assertString(operation.id, `${name}.id`);

    if (!Object.hasOwn(library.icons, operation.id)) {
      library.icons[operation.id] = loadCatalogIcon(operation.id);
    }

    assertInteger(operation.x, `${name}.x`);
    assertInteger(operation.y, `${name}.y`);
    assertInteger(operation.width, `${name}.width`, 1);
    assertInteger(operation.height, `${name}.height`, 1);
    const color = optionalColor(operation.color, `${name}.color`);

    if (color === null) {
      throw new Error(`${name}.color is required`);
    }

    canvas.assertPoint(operation.x, operation.y);
    canvas.assertPoint(operation.x + operation.width - 1, operation.y + operation.height - 1);
    const mark = library.icons[operation.id].mark;

    if (displayWidth(mark) > operation.width) {
      throw new Error(`SVG icon ${operation.id} needs at least ${displayWidth(mark)} columns for its text fallback`);
    }

    return {
      color,
      height: operation.height,
      id: operation.id,
      mark,
      width: operation.width,
      x: operation.x,
      y: operation.y,
    };
  });

  const reservedCells = new Map();

  for (const [iconIndex, icon] of placements.entries()) {
    for (let y = icon.y; y < icon.y + icon.height; y += 1) {
      for (let x = icon.x; x < icon.x + icon.width; x += 1) {
        const cellKey = `${x},${y}`;
        const firstIconIndex = reservedCells.get(cellKey);

        if (firstIconIndex !== undefined) {
          throw new Error(`SVG icons overlap: icons[${firstIconIndex}] and icons[${iconIndex}]`);
        }

        reservedCells.set(cellKey, iconIndex);

        if (canvas.masks[y][x] !== 0 || canvas.characters[y][x] !== null) {
          throw new Error(`SVG icon ${icon.id} collides with diagram content at ${x},${y}`);
        }
      }
    }
  }

  for (const icon of placements) {
    const markX = icon.x + Math.floor((icon.width - displayWidth(icon.mark)) / 2);
    const markY = icon.y + Math.floor((icon.height - 1) / 2);
    canvas.text(markX, markY, icon.mark, { color: icon.color });
  }

  return placements.map(({ mark: _mark, ...placement }) => placement);
}

function boxCenterX(box) {
  return box.x + Math.floor((box.width - 1) / 2);
}

function boxCenterY(box) {
  return box.y + Math.floor((box.height - 1) / 2);
}

function resolveEndpoint(value, boxes, role) {
  if (Array.isArray(value)) {
    if (value.length !== 2) {
      throw new Error("A point must contain x and y");
    }

    return { point: value, port: null };
  }

  if (!value || typeof value !== "object" || typeof value.box !== "string" || typeof value.port !== "string") {
    throw new Error(`${role} must be [x,y] or a box-port reference`);
  }

  const box = boxes.get(value.box);

  if (!box) {
    throw new Error(`Unknown box in ${role}: ${value.box}`);
  }

  const targetOffset = role === "to" ? 1 : 0;
  const port = value.port;

  if (port === "top") {
    return { point: [boxCenterX(box), box.y - targetOffset], port };
  }

  if (port === "bottom") {
    return { point: [boxCenterX(box), box.y + box.height - 1 + targetOffset], port };
  }

  if (port === "left") {
    return { point: [box.x - targetOffset, boxCenterY(box)], port };
  }

  if (port === "right") {
    return { point: [box.x + box.width - 1 + targetOffset, boxCenterY(box)], port };
  }

  throw new Error(`Unknown box port in ${role}: ${port}`);
}

function defaultRoute(start, end, fromPort, toPort, route) {
  if (start[0] === end[0] || start[1] === end[1]) {
    return [start, end];
  }

  if (route === "horizontal-first") {
    return [start, [end[0], start[1]], end];
  }

  if (route === "vertical-first") {
    return [start, [start[0], end[1]], end];
  }

  const verticalPorts = new Set(["top", "bottom"]);

  if (verticalPorts.has(fromPort) || verticalPorts.has(toPort)) {
    const middleY = Math.floor((start[1] + end[1]) / 2);
    return [start, [start[0], middleY], [end[0], middleY], end];
  }

  const middleX = Math.floor((start[0] + end[0]) / 2);
  return [start, [middleX, start[1]], [middleX, end[1]], end];
}

function inferArrow(points, targetPort) {
  const portDirections = new Map([
    ["top", "south"],
    ["bottom", "north"],
    ["left", "east"],
    ["right", "west"],
  ]);

  if (targetPort) {
    return portDirections.get(targetPort);
  }

  const [previousX, previousY] = points.at(-2);
  const [x, y] = points.at(-1);

  if (x > previousX) return "east";
  if (x < previousX) return "west";
  if (y > previousY) return "south";
  return "north";
}

function normalizePathPoints(points) {
  if (!Array.isArray(points)) {
    throw new Error("Connector points must be an array");
  }

  const normalized = [];

  for (const [index, point] of points.entries()) {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new Error(`Connector point ${index} must contain x and y`);
    }

    assertInteger(point[0], `connector point ${index}.x`);
    assertInteger(point[1], `connector point ${index}.y`);
    const previous = normalized.at(-1);

    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      normalized.push(point);
    }
  }

  if (normalized.length < 2) {
    throw new Error("A connector needs at least two distinct points");
  }

  return normalized;
}

function hasCorrectArrowApproach(points, direction) {
  const [travelX, travelY] = arrowTravelOffsets.get(direction) ?? [];

  if (travelX === undefined) {
    throw new Error(`Unknown arrow direction: ${direction}`);
  }

  const [previousX, previousY] = points.at(-2);
  const [targetX, targetY] = points.at(-1);
  const deltaX = targetX - previousX;
  const deltaY = targetY - previousY;

  if (travelX !== 0) {
    return deltaY === 0 && Math.sign(deltaX) === travelX;
  }

  return deltaX === 0 && Math.sign(deltaY) === travelY;
}

function ensureArrowApproach(points, direction) {
  const normalized = normalizePathPoints(points);

  if (hasCorrectArrowApproach(normalized, direction)) {
    return normalized;
  }

  const [travelX, travelY] = arrowTravelOffsets.get(direction) ?? [];
  const target = normalized.at(-1);
  const prefix = normalized.slice(0, -1);
  const previous = prefix.at(-1);
  const approach = [target[0] - 2 * travelX, target[1] - 2 * travelY];
  const sameTravelAxis = travelX === 0 ? previous[0] === target[0] : previous[1] === target[1];

  if (sameTravelAxis) {
    throw new Error(
      `Connector approaches a ${direction} arrow from the wrong direction; add via points that approach the arrow from behind`,
    );
  }

  const bend = travelX === 0 ? [previous[0], approach[1]] : [approach[0], previous[1]];

  for (const point of [bend, approach, target]) {
    const last = prefix.at(-1);

    if (last[0] !== point[0] || last[1] !== point[1]) {
      prefix.push(point);
    }
  }

  if (!hasCorrectArrowApproach(prefix, direction)) {
    throw new Error(`Cannot create a valid ${direction} arrow approach`);
  }

  return prefix;
}

function resolvePath(operation, boxes) {
  if (operation.points) {
    return { points: operation.points, targetPort: null };
  }

  const from = resolveEndpoint(operation.from, boxes, "from");
  const to = resolveEndpoint(operation.to, boxes, "to");
  const via = operation.via ?? [];

  if (!Array.isArray(via)) {
    throw new Error("connector.via must be an array of points");
  }

  const points = via.length > 0 ? [from.point, ...via, to.point] : defaultRoute(from.point, to.point, from.port, to.port, operation.route);
  return { points, targetPort: to.port };
}

function placeText(canvas, operation, index) {
  assertString(operation.value, "text.value");
  assertInteger(operation.y, "text.y");
  const color = optionalColor(operation.color, `texts[${index}].color`);
  const width = displayWidth(operation.value);
  let x;

  if (operation.x === undefined) {
    x = Math.floor((canvas.width - width) / 2);
  } else {
    assertInteger(operation.x, "text.x");
    x = operation.anchor === "center" ? operation.x - Math.floor(width / 2) : operation.anchor === "right" ? operation.x - width + 1 : operation.x;
  }

  canvas.text(x, operation.y, operation.value, { color, overlay: operation.overlay === true });
}

function buildDiagram(spec) {
  if (!spec || typeof spec !== "object" || !spec.canvas || typeof spec.canvas !== "object") {
    throw new Error("The specification needs a canvas object");
  }

  const canvas = new TerminalCanvas(spec.canvas.width, spec.canvas.height);
  const boxOperations = Array.isArray(spec.boxes) ? spec.boxes : [];
  const boxes = boxOperations.map(measureBox);
  validateBoxPlacement(boxes);
  const boxesById = new Map();

  for (const box of boxes) {
    if (box.id) {
      if (boxesById.has(box.id)) {
        throw new Error(`Duplicate box id: ${box.id}`);
      }

      boxesById.set(box.id, box);
    }

    canvas.box(box);
  }

  for (const [index, operation] of (spec.lines ?? []).entries()) {
    const { points } = resolvePath(operation, boxesById);
    const color = optionalColor(operation.color, `lines[${index}].color`);
    canvas.polyline(points, color);
  }

  for (const [index, operation] of (spec.connectors ?? []).entries()) {
    const { points, targetPort } = resolvePath(operation, boxesById);
    const normalized = normalizePathPoints(points);
    const direction = operation.arrow ?? inferArrow(normalized, targetPort);
    const routedPoints = ensureArrowApproach(normalized, direction);
    const color = optionalColor(operation.color, `connectors[${index}].color`);
    const arrowColor = optionalColor(operation.arrowColor, `connectors[${index}].arrowColor`) ?? color;
    canvas.polyline(routedPoints, color);
    canvas.arrow(...routedPoints.at(-1), direction, arrowColor);
  }

  for (const [index, operation] of (spec.arrows ?? []).entries()) {
    const color = optionalColor(operation.color, `arrows[${index}].color`);
    canvas.arrow(operation.x, operation.y, operation.direction, color);
  }

  for (const [index, operation] of (spec.texts ?? []).entries()) {
    placeText(canvas, operation, index);
  }

  const icons = normalizeIconPlacements(spec.icons, canvas);
  const result = canvas.render();
  let pngCells = result.cells;

  if (icons.length > 0) {
    const pngWidth = Math.max(result.cells[0]?.length ?? 0, ...icons.map((icon) => icon.x + icon.width));
    const pngHeight = Math.max(result.cells.length, ...icons.map((icon) => icon.y + icon.height));
    pngCells = Array.from({ length: pngHeight }, (_, y) =>
      Array.from({ length: pngWidth }, (_, x) => ({ ...(result.cells[y]?.[x] ?? { color: null, glyph: " " }) })),
    );
  }

  for (const icon of icons) {
    for (let y = icon.y; y < icon.y + icon.height; y += 1) {
      for (let x = icon.x; x < icon.x + icon.width; x += 1) {
        pngCells[y][x] = { color: null, glyph: " " };
      }
    }
  }

  for (const label of spec.requiredLabels ?? []) {
    assertString(label, "requiredLabels entry");

    if (!result.text.includes(label)) {
      throw new Error(`Required label is missing from output: ${label}`);
    }
  }

  return { ...result, icons, pngCells };
}


export { buildDiagram, loadSvgIconLibrary, loadCatalogIcon };
