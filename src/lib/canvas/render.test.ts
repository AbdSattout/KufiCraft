import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_CONFIG,
  MAX_THUMBNAIL_LENGTH,
  archKey,
  lineKey,
  tileKey,
} from "@/lib/canvas/model";
import type {
  CanvasItem,
  ProjectConfig,
  TileShape,
} from "@/lib/canvas/model";
import { renderSvg, renderThumbnail } from "@/lib/canvas/render";

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

const TILE: CanvasItem = { t: "tile", k: tileKey(1, 2, 0), i: 1, j: 2, q: 0 };
const SHAPED_TILE: CanvasItem = {
  t: "tile",
  k: tileKey(3, 4, 3),
  i: 3,
  j: 4,
  q: 3,
  s: "hamza1",
  c: "#ff0000",
};
const LINE: CanvasItem = {
  t: "line",
  k: lineKey(0, 5, 4, 5),
  i1: 0,
  j1: 5,
  i2: 4,
  j2: 5,
};
const ARCH: CanvasItem = {
  t: "arch",
  k: archKey(0, 6, 4, 6, 0),
  i1: 0,
  j1: 6,
  i2: 4,
  j2: 6,
  d: 0,
};

const ITEMS: CanvasItem[] = [TILE, SHAPED_TILE, LINE, ARCH];

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
      ITEMS.map((item) => item.k),
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

  it("strokes arches with ratio · base", () => {
    const config = makeConfig({ ratio: 0.75, base: 10, ink: "#123456" });
    const root = rootOf(renderSvg(config, [ARCH]));
    const arch = find(root, "path")[0];
    expect(arch.attrs.fill).toBe("none");
    expect(arch.attrs.stroke).toBe("#123456");
    expect(arch.attrs["stroke-width"]).toBe("7.5");
  });

  it("draws the grid only when asked", () => {
    expect(find(rootOf(renderSvg(makeConfig(), [TILE])), "path")).toHaveLength(1);
    const withConfig = rootOf(
      renderSvg(makeConfig({ showGrid: true }), [TILE]),
    );
    expect(find(withConfig, "path")).toHaveLength(2);
    const grid = find(withConfig, "path")[0];
    expect(grid.attrs.fill).toBe("none");
    expect(grid.attrs.stroke).not.toBeUndefined();
    const withOption = rootOf(
      renderSvg(makeConfig({ showGrid: true }), [TILE], { showGrid: false }),
    );
    expect(find(withOption, "path")).toHaveLength(1);
  });

  it("draws circular construction rings and spokes", () => {
    const config = makeConfig({ gridType: "circular", base: 100 });
    const root = rootOf(renderSvg(config, [], { showGrid: true }));
    const grid = find(root, "path")[0];
    expect(grid.attrs.d).toContain("A 100 100");
    expect(grid.attrs.d).toContain("A 500 500");
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
    const shapes: TileShape[] = [
      "square",
      "circle",
      "triangle",
      "quadrant",
      "semicircle",
      "hexagon",
      "arc",
      "hamza1",
      "hamza2",
    ];
    const items: CanvasItem[] = shapes.map((shape, index) => ({
      t: "tile",
      k: tileKey(index, 0, 0),
      i: index,
      j: 0,
      q: 0,
      s: shape,
      r: (index % 4) as 0 | 1 | 2 | 3,
    }));
    for (const gridType of ["square", "circular"] as const) {
      const root = rootOf(renderSvg(makeConfig({ gridType }), items));
      expect(find(root, "path")).toHaveLength(shapes.length);
    }
  });
});

describe("renderThumbnail", () => {
  const dense = (count: number): CanvasItem[] => {
    const items: CanvasItem[] = [];
    for (let n = 0; n < count; n++) {
      const i = n % 100;
      const j = Math.floor(n / 100) % 100;
      items.push({
        t: "tile",
        k: tileKey(i, j, (n % 4) as 0 | 1 | 2 | 3),
        i,
        j,
        q: (n % 4) as 0 | 1 | 2 | 3,
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
