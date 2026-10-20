import { describe, expect, it } from "vitest";
import {
  CORNER_ALL,
  DEFAULT_PROJECT_CONFIG,
  MAX_THUMBNAIL_LENGTH,
  SHAPE_IDS,
  arcKey,
  lineKey,
  strokeKey,
  tileKey,
} from "@/lib/canvas/model";
import type {
  CanvasItem,
  ProjectConfig,
  Rotation,
  Zone,
} from "@/lib/canvas/model";
import { renderSvg, renderThumbnail } from "@/lib/canvas/render";
import { inkUnit } from "@/lib/canvas/geometry";

/* ------------------------------------------------------------------ */
/* a tiny strict XML reader (node has no DOMParser)                    */
/* ------------------------------------------------------------------ */

interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: XmlElement[];
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&");
}

function parseXml(source: string): XmlElement {
  const document: XmlElement = { tag: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [document];
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf("<", index);
    if (start === -1) {
      const tail = source.slice(index);
      if (tail.trim() !== "") throw new Error(`stray text: ${tail}`);
      break;
    }
    const text = source.slice(index, start);
    if (text.trim() !== "") throw new Error(`stray text: ${text}`);
    const end = source.indexOf(">", start);
    if (end === -1) throw new Error("unterminated tag");
    const raw = source.slice(start + 1, end);
    if (raw.startsWith("/")) {
      const open = stack.pop();
      if (open === undefined || open.tag !== raw.slice(1).trim()) {
        throw new Error(`mismatched closing tag </${raw.slice(1)}>`);
      }
    } else {
      const selfClosing = raw.endsWith("/");
      const body = (selfClosing ? raw.slice(0, -1) : raw).trim();
      const match = /^([A-Za-z][\w:-]*)((?:\s+[A-Za-z][\w:-]*="[^"]*")*)\s*$/.exec(body);
      if (match === null) throw new Error(`malformed tag <${body}>`);
      const attrs: Record<string, string> = {};
      const attrPattern = /([A-Za-z][\w:-]*)="([^"]*)"/g;
      let attr: RegExpExecArray | null;
      while ((attr = attrPattern.exec(match[2])) !== null) {
        const raw = attr[2];
        const leftover = raw
          .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, "")
          .replace(/[^<&]+/g, "");
        if (leftover !== "") {
          throw new Error(`unescaped character in attribute ${attr[1]}`);
        }
        attrs[attr[1]] = decodeEntities(raw);
      }
      const leftover = match[2]
        .replace(/[A-Za-z][\w:-]*="[^"]*"/g, "")
        .replace(/\s+/g, "");
      if (leftover !== "") throw new Error(`malformed attributes in <${body}>`);
      const element: XmlElement = { tag: match[1], attrs, children: [] };
      stack[stack.length - 1].children.push(element);
      if (!selfClosing) stack.push(element);
    }
    index = end + 1;
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1].tag}>`);
  return document;
}

function rootOf(source: string): XmlElement {
  const document = parseXml(source);
  if (document.children.length !== 1) throw new Error("expected exactly one root");
  return document.children[0];
}

function find(element: XmlElement, tag: string): XmlElement[] {
  const found: XmlElement[] = [];
  for (const child of element.children) {
    if (child.tag === tag) found.push(child);
    found.push(...find(child, tag));
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return { ...DEFAULT_PROJECT_CONFIG, ...overrides };
}

const TILE: CanvasItem = {
  type: "tile",
  key: tileKey(1, 2, 0),
  column: 1,
  row: 2,
  zone: 0,
};
const SHAPED_TILE: CanvasItem = {
  type: "tile",
  key: tileKey(3, 4, 3),
  column: 3,
  row: 4,
  zone: 3,
  shape: "hamza1",
  color: "#ff0000",
};
const LINE: CanvasItem = {
  type: "line",
  key: lineKey({ column: 0, row: 5 }, { column: 4, row: 5 }),
  from: { column: 0, row: 5 },
  to: { column: 4, row: 5 },
};
const STROKE: CanvasItem = {
  type: "stroke",
  key: strokeKey(
    [
      { column: 0, row: 7 },
      { column: 2, row: 9 },
    ],
    false,
  ),
  points: [
    { column: 0, row: 7 },
    { column: 2, row: 9 },
  ],
};
const ARC: CanvasItem = {
  type: "arc",
  key: arcKey(
    { column: 0, row: 6 },
    { column: 4, row: 6 },
    "counterclockwise",
    "half",
  ),
  from: { column: 0, row: 6 },
  to: { column: 4, row: 6 },
  direction: "counterclockwise",
  size: "half",
};

const ITEMS: CanvasItem[] = [TILE, SHAPED_TILE, LINE, STROKE, ARC];

describe("renderSvg", () => {
  it("emits XML with exactly one element per item", () => {
    const root = rootOf(renderSvg(makeConfig(), ITEMS));
    expect(root.tag).toBe("svg");
    expect(root.attrs.viewBox).toBe("0 0 1000 1000");
    expect(root.attrs["xmlns"]).toBe("http://www.w3.org/2000/svg");
    const rects = find(root, "rect");
    const paths = find(root, "path");
    expect(rects).toHaveLength(1);
    expect(rects[0].attrs.fill).toBe(DEFAULT_PROJECT_CONFIG.background);
    expect(paths).toHaveLength(ITEMS.length);
    expect(paths.map((path) => path.attrs["data-k"])).toEqual(
      ITEMS.map((item) => item.key),
    );
    for (const path of paths) {
      expect(path.attrs.d.startsWith("M ")).toBe(true);
      expect(path.attrs.d).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it("skips the background rect when it is transparent", () => {
    const root = rootOf(
      renderSvg(makeConfig({ background: "transparent" }), []),
    );
    expect(find(root, "rect")).toHaveLength(0);
    expect(find(root, "path")).toHaveLength(0);
  });

  it("paints tiles with their colour override and ink otherwise", () => {
    const root = rootOf(renderSvg(makeConfig({ ink: "#123456" }), ITEMS));
    const paths = find(root, "path");
    expect(paths[0].attrs.fill).toBe("#123456");
    expect(paths[1].attrs.fill).toBe("#ff0000");
    expect(paths[0].attrs.stroke).toBeUndefined();
  });

  it("strokes arcs with the drawn ink thickness", () => {
    const config = makeConfig({ ratio: 0.75, base: 10, ink: "#123456" });
    const root = rootOf(renderSvg(config, [ARC]));
    const arc = find(root, "path")[0];
    expect(arc.attrs.fill).toBe("none");
    expect(arc.attrs.stroke).toBe("#123456");
    // The drawn cell is 1000/99.75, so the ink is 7.518797 — rounded to the
    // 3 decimals every number in the SVG goes through.
    expect(arc.attrs["stroke-width"]).toBe("7.519");
  });

  it("draws the grid as two paths only when asked", () => {
    expect(find(rootOf(renderSvg(makeConfig(), [TILE])), "path")).toHaveLength(1);
    const withConfig = rootOf(
      renderSvg(makeConfig({ showGrid: true }), [TILE]),
    );
    const paths = find(withConfig, "path");
    expect(paths).toHaveLength(3);
    // Cell borders first, then the stronger inner ink lines.
    expect(paths[0].attrs.fill).toBe("none");
    expect(paths[0].attrs.stroke).not.toBeUndefined();
    expect(paths[0].attrs["stroke-opacity"]).toBe("0.28");
    expect(paths[1].attrs["stroke-opacity"]).toBe("0.55");
    const withOption = rootOf(
      renderSvg(makeConfig({ showGrid: true }), [TILE], { showGrid: false }),
    );
    expect(find(withOption, "path")).toHaveLength(1);
  });

  it("draws circular construction rings and spokes", () => {
    // base 100 on the polar grid → 5 drawn bands, so the rings sit at
    // 105.263158 … 421.052632 (the last band's space is cropped).
    const config = makeConfig({ gridType: "circular", base: 100 });
    const root = rootOf(renderSvg(config, [], { showGrid: true }));
    const grid = find(root, "path")[0];
    expect(grid.attrs.d).toContain("A 105.263158 105.263158");
    expect(grid.attrs.d).toContain("A 421.052632 421.052632");
    expect((grid.attrs.d.match(/\bL\b/g) ?? []).length).toBeGreaterThan(35);
  });

  it("honours the size option", () => {
    const root = rootOf(renderSvg(makeConfig(), [], { size: 320 }));
    expect(root.attrs.width).toBe("320");
    expect(root.attrs.height).toBe("320");
  });

  it("escapes user colours instead of breaking the markup", () => {
    const hostile = '#fff" onload="alert(1)';
    const root = rootOf(renderSvg(makeConfig({ ink: hostile }), [TILE]));
    expect(find(root, "path")[0].attrs.fill).toBe(hostile);
  });

  it("is deterministic", () => {
    const config = makeConfig({ showGrid: true });
    expect(renderSvg(config, ITEMS)).toBe(renderSvg(config, ITEMS));
  });

  it("renders every shape and both grid types without breaking the XML", () => {
    const shapes = SHAPE_IDS;
    const items: CanvasItem[] = shapes.map((shape, index) => ({
      type: "tile",
      key: tileKey(index, 0, 0),
      column: index,
      row: 0,
      zone: 0,
      shape,
      rotation: (index % 4) as Rotation,
    }));
    for (const gridType of ["square", "circular"] as const) {
      const root = rootOf(renderSvg(makeConfig({ gridType }), items));
      expect(find(root, "path")).toHaveLength(shapes.length);
    }
  });
});

describe("style in the SVG renderer", () => {
  const ROUNDING = { radius: 0.2, corners: CORNER_ALL };
  const ROUNDED: CanvasItem = {
    type: "tile",
    key: tileKey(1, 2, 0),
    column: 1,
    row: 2,
    zone: 0,
    rounding: ROUNDING,
  };
  const BORDERED: CanvasItem = {
    type: "tile",
    key: tileKey(1, 2, 0),
    column: 1,
    row: 2,
    zone: 0,
    border: { width: 3, color: "#ff0000" },
  };

  it("renders a tile with and without rounding", () => {
    const config = makeConfig();
    const plain = find(rootOf(renderSvg(config, [TILE])), "path");
    const rounded = find(rootOf(renderSvg(config, [ROUNDED])), "path");

    expect(plain).toHaveLength(1);
    expect(rounded).toHaveLength(1);
    expect(plain[0].attrs.d).not.toContain(" C ");
    expect(rounded[0].attrs.d).toContain(" C ");
    expect(rounded[0].attrs.d).not.toBe(plain[0].attrs.d);
    // Rounding changes the outline, never the item's colour or identity.
    expect(rounded[0].attrs.fill).toBe(plain[0].attrs.fill);
    expect(rounded[0].attrs["data-k"]).toBe(TILE.key);
  });

  it("paints the border as one wider stroke of the same path, before the ink", () => {
    const config = makeConfig({ ink: "#123456" });
    const paths = find(rootOf(renderSvg(config, [BORDERED])), "path");
    expect(paths).toHaveLength(2);

    const [outline, ink] = paths;
    // The tile is filled, so the border is a native stroke of the same path,
    // 2 × width, with no fill of its own.
    expect(outline.attrs.fill).toBe("none");
    expect(outline.attrs.stroke).toBe("#ff0000");
    expect(outline.attrs["stroke-width"]).toBe("6");
    expect(outline.attrs.transform).toBeUndefined();
    expect(outline.attrs["data-k"]).toBe(BORDERED.key);
    expect(outline.attrs.d).toBe(ink.attrs.d);

    expect(ink.attrs.fill).toBe("#123456");
    expect(ink.attrs.transform).toBeUndefined();
    expect(ink.attrs.stroke).toBeUndefined();
  });

  it("widens a stroked item's border by the band on each side", () => {
    const config = makeConfig({ ink: "#123456" });
    const inkWidth = inkUnit(config);
    const items: CanvasItem[] = [
      {
        type: "stroke",
        key: strokeKey(
          [
            { column: 0, row: 0 },
            { column: 2, row: 2 },
          ],
          false,
        ),
        points: [
          { column: 0, row: 0 },
          { column: 2, row: 2 },
        ],
        border: { width: 2, color: "#000000" },
      },
      {
        type: "arc",
        key: arcKey(
          { column: 0, row: 6 },
          { column: 3, row: 6 },
          "clockwise",
          "half",
        ),
        from: { column: 0, row: 6 },
        to: { column: 3, row: 6 },
        direction: "clockwise",
        size: "half",
        border: { width: 2, color: "#000000" },
      },
    ];
    for (const item of items) {
      const paths = find(rootOf(renderSvg(config, [item])), "path");
      expect(paths).toHaveLength(2);
      const [outline, ink] = paths;
      expect(outline.attrs.transform).toBeUndefined();
      expect(outline.attrs.fill).toBe("none");
      expect(outline.attrs.stroke).toBe("#000000");
      expect(outline.attrs["stroke-width"]).toBe(
        String(Math.round((inkWidth + 4) * 1000) / 1000),
      );
      expect(outline.attrs.d).toBe(ink.attrs.d);
      expect(ink.attrs.fill).toBe("none");
      expect(ink.attrs.stroke).toBe("#123456");
      expect(ink.attrs["stroke-width"]).toBe(
        String(Math.round(inkWidth * 1000) / 1000),
      );
    }

    // A line bar is filled: its border is a 2 × width outline, not a widened
    // stroke.
    const bar: CanvasItem = {
      type: "line",
      key: lineKey({ column: 0, row: 1 }, { column: 3, row: 1 }),
      from: { column: 0, row: 1 },
      to: { column: 3, row: 1 },
      border: { width: 2, color: "#000000" },
    };
    const [barOutline, barInk] = find(rootOf(renderSvg(config, [bar])), "path");
    expect(barOutline.attrs["stroke-width"]).toBe("4");
    expect(barOutline.attrs.fill).toBe("none");
    expect(barInk.attrs.fill).toBe("#123456");
  });

  it("uses a stroked item's cap and join on its ink and its border", () => {
    const item: CanvasItem = {
      type: "stroke",
      key: strokeKey(
        [
          { column: 0, row: 0 },
          { column: 2, row: 2 },
        ],
        false,
      ),
      points: [
        { column: 0, row: 0 },
        { column: 2, row: 2 },
      ],
      cap: "round",
      join: "bevel",
      border: { width: 2, color: "#ff0000" },
    };
    const [outline, ink] = find(rootOf(renderSvg(makeConfig(), [item])), "path");
    for (const path of [outline, ink]) {
      expect(path.attrs["stroke-linecap"]).toBe("round");
      expect(path.attrs["stroke-linejoin"]).toBe("bevel");
    }
    // The default stays exactly the pre-option rendering.
    const plain: CanvasItem = {
      type: "line",
      key: lineKey({ column: 0, row: 0 }, { column: 2, row: 2 }),
      from: { column: 0, row: 0 },
      to: { column: 2, row: 2 },
    };
    const [plainInk] = find(rootOf(renderSvg(makeConfig(), [plain])), "path");
    expect(plainInk.attrs["stroke-linecap"]).toBe("butt");
    expect(plainInk.attrs["stroke-linejoin"]).toBe("miter");
  });

  it("uses the stored border colour, independently of the item colour", () => {
    const config = makeConfig({ ink: "#123456" });
    const item: CanvasItem = {
      ...BORDERED,
      color: "#abcdef",
      border: { width: 2, color: "#ff0000" },
    };
    const [outline] = find(rootOf(renderSvg(config, [item])), "path");
    expect(outline.attrs.stroke).toBe("#ff0000");
  });

  it("removes the border when its width is zero", () => {
    const config = makeConfig({ ink: "#123456" });
    const item: CanvasItem = {
      ...BORDERED,
      border: { width: 0, color: "#ff0000" },
    };
    const paths = find(rootOf(renderSvg(config, [item])), "path");
    expect(paths).toHaveLength(1);
    expect(paths[0].attrs.fill).toBe("#123456");
  });

  it("escapes a hostile border colour", () => {
    const hostile = '#fff" onload="alert(1)';
    const item: CanvasItem = {
      ...BORDERED,
      border: { width: 2, color: hostile },
    };
    const source = renderSvg(makeConfig(), [item]);
    expect(source).not.toContain("<script");
    const [outline] = find(rootOf(source), "path");
    expect(outline.attrs.stroke).toBe(hostile);
  });

  it("keeps rounding and borders in thumbnails", () => {
    const items = [ROUNDED, BORDERED];
    const root = rootOf(renderThumbnail(makeConfig(), items));
    const paths = find(root, "path");
    // The rounded tile, then the bordered tile's outline and its ink.
    expect(paths).toHaveLength(3);
    expect(paths[0].attrs.d).toContain(" C ");
    expect(paths[1].attrs.stroke).toBe("#ff0000");
    expect(paths[1].attrs["stroke-width"]).toBe("6");
    expect(paths[1].attrs.transform).toBeUndefined();
    expect(paths[2].attrs.fill).not.toBe("none");
  });

  it("keeps stroke caps and joins in thumbnails", () => {
    const item: CanvasItem = {
      ...STROKE,
      cap: "square",
      join: "round",
      border: { width: 2, color: "#ff0000" },
    };
    const paths = find(rootOf(renderThumbnail(makeConfig(), [item])), "path");
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path.attrs["stroke-linecap"]).toBe("square");
      expect(path.attrs["stroke-linejoin"]).toBe("round");
    }
  });

  it("paints the same border paths in the SVG export and thumbnail", () => {
    const config = makeConfig();
    const items = [ROUNDED, BORDERED];
    const svgPaths = find(rootOf(renderSvg(config, items)), "path");
    const thumbnailPaths = find(
      rootOf(renderThumbnail(config, items)),
      "path",
    );
    expect(thumbnailPaths).toHaveLength(svgPaths.length);
    // The thumbnail rounds path coordinates to one decimal; the geometry is
    // the same once both paths are read at that precision.
    const atThumbnailPrecision = (path: string): string =>
      path.replace(/-?\d+(?:\.\d+)?/g, (value) =>
        String(Math.round(Number(value) * 10) / 10),
      );
    for (const [index, path] of svgPaths.entries()) {
      const thumbnail = thumbnailPaths[index];
      expect(atThumbnailPrecision(path.attrs.d)).toBe(
        atThumbnailPrecision(thumbnail.attrs.d),
      );
      expect(path.attrs.fill).toBe(thumbnail.attrs.fill);
      expect(path.attrs.stroke).toBe(thumbnail.attrs.stroke);
      expect(path.attrs["stroke-width"]).toBe(thumbnail.attrs["stroke-width"]);
      expect(path.attrs["stroke-linecap"]).toBe(
        thumbnail.attrs["stroke-linecap"],
      );
      expect(path.attrs["stroke-linejoin"]).toBe(
        thumbnail.attrs["stroke-linejoin"],
      );
      expect(path.attrs.transform).toBeUndefined();
    }
  });
});

describe("renderThumbnail", () => {
  const dense = (count: number): CanvasItem[] => {
    const items: CanvasItem[] = [];
    for (let n = 0; n < count; n++) {
      const column = n % 100;
      const row = Math.floor(n / 100) % 100;
      const zone = (n % 4) as Zone;
      items.push({
        type: "tile",
        key: tileKey(column, row, zone),
        column,
        row,
        zone,
      });
    }
    return items;
  };

  it("stays inside the backend limit for dense artwork", () => {
    const thumbnail = renderThumbnail(makeConfig(), dense(6000));
    expect(thumbnail.length).toBeLessThanOrEqual(MAX_THUMBNAIL_LENGTH);
    expect(thumbnail.length).toBeGreaterThan(0);
    const root = rootOf(thumbnail);
    expect(find(root, "path").length).toBeGreaterThan(0);
    expect(find(root, "path").length).toBeLessThan(6000);
  });

  it("never draws the grid and always uses the light background", () => {
    const config = makeConfig({
      showGrid: true,
      background: "#000000",
      gridType: "circular",
    });
    const thumbnail = renderThumbnail(config, dense(50));
    const root = rootOf(thumbnail);
    const rects = find(root, "rect");
    expect(rects).toHaveLength(1);
    expect(rects[0].attrs.fill).toBe("#ffffff");
    expect(find(root, "path")).toHaveLength(50);
  });

  it("drops keys and reduces path precision", () => {
    const thumbnail = renderThumbnail(makeConfig({ ratio: 0.75, base: 10 }), ITEMS);
    const root = rootOf(thumbnail);
    for (const path of find(root, "path")) {
      expect(path.attrs["data-k"]).toBeUndefined();
      expect(path.attrs.d).not.toMatch(/\.\d\d/);
    }
    expect(find(root, "path")).toHaveLength(ITEMS.length);
  });

  it("handles an empty canvas", () => {
    const root = rootOf(renderThumbnail(makeConfig(), []));
    expect(root.attrs.viewBox).toBe("0 0 1000 1000");
    expect(find(root, "path")).toHaveLength(0);
    expect(find(root, "rect")).toHaveLength(1);
  });

  it("is deterministic and lossless for small artwork", () => {
    const config = makeConfig();
    expect(renderThumbnail(config, ITEMS)).toBe(renderThumbnail(config, ITEMS));
    expect(renderThumbnail(config, ITEMS)).toContain("<path");
  });
});
