import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropCallbackInEffect } from "./no-prop-callback-in-effect.js";

const source = `import { useEffect, useState } from "react";
import useCarousel from "embla-carousel-react";

export function PreviewCarousel({ onReady, options }) {
  const [viewport, engine] = useCarousel(options);
  const [currentSlide, setCurrentSlide] = useState(0);
  useEffect(() => {
    if (!engine || !onReady) return;
    onReady(engine);
  }, [engine, onReady]);
  return <div ref={viewport} onClick={() => setCurrentSlide(currentSlide + 1)} />;
}
`;

const warnings = (code: string) => {
  const result = runRule(noPropCallbackInEffect, code, { includeLocations: true });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("Embla Carousel API handoff", () => {
  it("allows the guarded handoff of the API instance", () => {
    expect(warnings(source)).toEqual([]);
  });

  it("accepts a block around the early return", () => {
    expect(
      warnings(
        source.replace("if (!engine || !onReady) return;", "if (!engine || !onReady) { return; }"),
      ),
    ).toEqual([]);
  });

  it("keeps a state mirror in a separate effect that uses the same prop", () => {
    const mixed = source.replace(
      "  return <div",
      "  useEffect(() => { onReady(currentSlide); }, [currentSlide, onReady]);\n  return <div",
    );
    expect(warnings(mixed)).toHaveLength(1);
  });

  it.each([
    [
      "local state",
      source
        .replace("onReady(engine);", "onReady(currentSlide);")
        .replace("[engine, onReady]", "[engine, onReady, currentSlide]"),
    ],
    [
      "a state value mixed with the handle",
      source
        .replace("onReady(engine);", "onReady(engine, currentSlide);")
        .replace("[engine, onReady]", "[engine, onReady, currentSlide]"),
    ],
    [
      "a value computed from the engine",
      source.replace("onReady(engine);", "onReady(engine.selectedScrollSnap());"),
    ],
    ["the viewport callback slot", source.replace("[viewport, engine]", "[engine, viewport]")],
    [
      "an explicitly mocked provider",
      source.replace(
        "export function",
        'vi["mock"]("embla-carousel-react", createMock);\nexport function',
      ),
    ],
    ["another provider", source.replace('"embla-carousel-react"', '"other-carousel-provider"')],
    [
      "additional effect logic",
      source.replace("    onReady(engine);", "    onReady(engine);\n    syncToStorage(engine);"),
    ],
  ])("continues reporting %s", (_case, code) => {
    expect(warnings(code)).toHaveLength(1);
  });
});
