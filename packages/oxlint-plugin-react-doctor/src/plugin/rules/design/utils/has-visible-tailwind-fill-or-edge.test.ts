import { describe, expect, it } from "vite-plus/test";
import { hasVisibleTailwindFillOrEdge } from "./has-visible-tailwind-fill-or-edge.js";

describe("hasVisibleTailwindFillOrEdge", () => {
  it("recognizes visible fills, borders, and rings", () => {
    expect(hasVisibleTailwindFillOrEdge(["bg-blue-100"])).toBe(true);
    expect(hasVisibleTailwindFillOrEdge(["border"])).toBe(true);
    expect(hasVisibleTailwindFillOrEdge(["border-l-2"])).toBe(true);
    expect(hasVisibleTailwindFillOrEdge(["ring-2"])).toBe(true);
  });

  it("rejects transparent and non-drawing utilities", () => {
    expect(hasVisibleTailwindFillOrEdge(["bg-transparent"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["border-0"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["border", "border-transparent"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["ring-0"])).toBe(false);
  });

  it("uses the effective background color and opacity utilities", () => {
    expect(hasVisibleTailwindFillOrEdge(["bg-blue-100", "bg-transparent"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["bg-transparent", "bg-blue-100"])).toBe(true);
    expect(hasVisibleTailwindFillOrEdge(["bg-blue-100", "bg-opacity-0", "bg-opacity-100"])).toBe(
      true,
    );
    expect(hasVisibleTailwindFillOrEdge(["bg-blue-100", "bg-opacity-100", "bg-opacity-0"])).toBe(
      false,
    );
  });
});
