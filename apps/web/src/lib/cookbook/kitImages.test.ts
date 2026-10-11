import { describe, expect, it, vi } from "vitest";
import { readKit } from "./sources.ts";

// The images and viewer kit blocks in Node with a stubbed browser: an Image
// that decodes at once, the engine's registry and painter as spies (#731).

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#d33"/></svg>';

function images({ inline }: { inline?: (svg: string) => Promise<string> } = {}) {
  class Image {
    src = "";
    decode = vi.fn(async () => {});
  }
  const registerResourceImage = vi.fn();
  const names = ["Image", "registerResourceImage", "fetch", "createImageBitmap", ...(inline ? ["inlineSvgFonts"] : [])];
  const run = new Function(...names, `${readKit().images}\nreturn { loadSvg, imageBytes };`) as (...args: unknown[]) => {
    loadSvg: (fileId: string, svg: string, options?: Record<string, unknown>) => Promise<void>;
    imageBytes: (fileId: string) => Uint8Array | undefined;
  };
  const fetch = vi.fn(async () => { throw new Error("loadSvg fetches nothing for an SVG without text"); });
  return { ...run(Image, registerResourceImage, fetch, vi.fn(), ...(inline ? [inline] : [])), registerResourceImage, Image };
}

describe("kit block images: loadSvg", () => {
  it("hands its options to registerResourceImage and keeps the bytes", async () => {
    const { loadSvg, imageBytes, registerResourceImage, Image } = images();
    await loadSvg("moon.svg", SVG, { singleInk: true });
    expect(registerResourceImage).toHaveBeenCalledTimes(1);
    const [fileId, img, options] = registerResourceImage.mock.calls[0];
    expect(fileId).toBe("moon.svg");
    expect(img).toBeInstanceOf(Image);
    expect((img as { src: string }).src).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`);
    expect((img as { decode: unknown }).decode).toHaveBeenCalled();
    expect(options).toEqual({ singleInk: true });
    expect(new TextDecoder().decode(imageBytes("moon.svg"))).toBe(SVG);
  });

  it("registers as before when no options are given", async () => {
    const { loadSvg, imageBytes, registerResourceImage } = images();
    await loadSvg("plain.svg", SVG);
    expect(registerResourceImage.mock.calls[0]).toHaveLength(3);
    expect(registerResourceImage.mock.calls[0][0]).toBe("plain.svg");
    expect(registerResourceImage.mock.calls[0][2]).toBeUndefined();
    expect(new TextDecoder().decode(imageBytes("plain.svg"))).toBe(SVG);
  });

  it("registers the markup with its fonts inside when the pen imports inlineSvgFonts", async () => {
    const inline = vi.fn(async (svg: string) => svg.replace("<circle", "<style>/* faces */</style><circle"));
    const { loadSvg, imageBytes, registerResourceImage } = images({ inline });
    await loadSvg("map.svg", SVG, { singleInk: false });
    expect(inline).toHaveBeenCalledWith(SVG, expect.any(Function));
    expect(registerResourceImage.mock.calls[0][2]).toEqual({ singleInk: false });
    expect(new TextDecoder().decode(imageBytes("map.svg"))).toContain("/* faces */");
  });
});

describe("kit block viewer: showPages", () => {
  function viewer() {
    const painted: unknown[][] = [];
    const renderPageToCanvas = vi.fn((...args: unknown[]) => { painted.push(args); });
    const canvases: Record<string, unknown>[] = [];
    const element = () => {
      const el: Record<string, unknown> = {
        style: {}, dataset: {}, children: [] as unknown[],
        append: (...kids: unknown[]) => (el.children as unknown[]).push(...kids),
        setAttribute: () => {}, replaceChildren: () => {}, insertAdjacentHTML: () => {},
      };
      return el;
    };
    const document = {
      title: "Recipe",
      head: element(), body: element(), documentElement: element(),
      getElementById: () => element(),
      createElement: (tag: string) => { const el = element(); if (tag === "canvas") canvases.push(el); return el; },
    };
    class IntersectionObserver {
      constructor(private seen: (entries: { isIntersecting: boolean; target: unknown }[]) => void) {}
      observe(target: unknown) { this.seen([{ isIntersecting: true, target }]); }
      unobserve() {}
      disconnect() {}
    }
    const run = new Function("document", "window", "IntersectionObserver", "renderPageToCanvas", "addEventListener",
      `${readKit().viewer}\nreturn { showPages };`) as (...args: unknown[]) => {
      showPages: (docs: unknown, options?: Record<string, unknown>) => number;
    };
    return { ...run(document, { devicePixelRatio: 2 }, IntersectionObserver, renderPageToCanvas, () => {}), painted, canvases };
  }
  const doc = { pages: [{ index: 0, width: 400, height: 600 }, { index: 1, width: 400, height: 600 }] };

  it("paints with the scale alone when the pen passes a title", () => {
    const { showPages, painted, canvases } = viewer();
    expect(showPages(doc, { title: "A zine" })).toBe(2);
    expect(painted).toHaveLength(2);
    expect(painted[0]).toEqual([doc.pages[0], doc, canvases[0], { scale: (460 * 2) / 400 }]);
  });

  it("hands every other option to renderPageToCanvas, and keeps its own scale", () => {
    const { showPages, painted } = viewer();
    const onWarning = () => {};
    showPages(doc, { title: "A zine", width: 300, singleInk: true, trim: true, onWarning, scale: 9 });
    expect(painted[1][3]).toEqual({ singleInk: true, trim: true, onWarning, scale: (300 * 2) / 400 });
  });
});
