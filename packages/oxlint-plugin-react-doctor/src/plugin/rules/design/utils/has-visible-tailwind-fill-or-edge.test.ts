import { describe, expect, it } from "vite-plus/test";
import {
  hasVisibleTailwindBoundary,
  hasVisibleTailwindClosedBorder,
  hasVisibleTailwindFillOrEdge,
  hasVisibleTailwindRing,
  hasVisibleTailwindShadow,
} from "./has-visible-tailwind-fill-or-edge.js";

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

  it("stays conservative for conflicting background color and opacity utilities", () => {
    expect(hasVisibleTailwindFillOrEdge(["bg-blue-100", "bg-transparent"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["bg-transparent", "bg-blue-100"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["bg-blue-100", "bg-opacity-0", "bg-opacity-100"])).toBe(
      false,
    );
    expect(hasVisibleTailwindFillOrEdge(["bg-blue-100", "bg-opacity-100", "bg-opacity-0"])).toBe(
      false,
    );
  });

  it("stays conservative for conflicting border width, style, color, and opacity", () => {
    expect(hasVisibleTailwindFillOrEdge(["border", "border-0"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["border-0", "border"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["border", "border-none"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["border", "border-none", "border-solid"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["border", "border-transparent"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["border", "border-transparent", "border-red-500"])).toBe(
      false,
    );
    expect(hasVisibleTailwindFillOrEdge(["border", "border-opacity-0"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["border", "border-opacity-0", "border-opacity-100"])).toBe(
      false,
    );
  });

  it("preserves directional border visibility and closed-surface semantics", () => {
    expect(hasVisibleTailwindBoundary(["border", "border-r-0"])).toBe(true);
    expect(hasVisibleTailwindClosedBorder(["border", "border-r-0"])).toBe(false);
    expect(hasVisibleTailwindClosedBorder(["border", "border-r-0", "border-r"])).toBe(false);
    expect(hasVisibleTailwindClosedBorder(["border-r-0", "border"])).toBe(false);
    expect(hasVisibleTailwindClosedBorder(["border", "border-r-transparent"])).toBe(false);
  });

  it("stays conservative for conflicting ring and shadow setters", () => {
    expect(hasVisibleTailwindRing(["ring", "ring-0"])).toBe(false);
    expect(hasVisibleTailwindRing(["ring-0", "ring"])).toBe(false);
    expect(hasVisibleTailwindRing(["ring", "ring-transparent"])).toBe(false);
    expect(hasVisibleTailwindRing(["ring", "ring-transparent", "ring-red-500"])).toBe(false);
    expect(hasVisibleTailwindRing(["ring", "ring-opacity-0"])).toBe(false);
    expect(hasVisibleTailwindShadow(["shadow", "shadow-none"])).toBe(false);
    expect(hasVisibleTailwindShadow(["shadow-none", "shadow-lg"])).toBe(false);
    expect(hasVisibleTailwindShadow(["shadow", "shadow-transparent"])).toBe(false);
    expect(hasVisibleTailwindShadow(["shadow", "shadow-transparent", "shadow-black"])).toBe(false);
  });

  it("honors important fill and boundary precedence", () => {
    expect(hasVisibleTailwindFillOrEdge(["!border", "border-0"])).toBe(true);
    expect(hasVisibleTailwindFillOrEdge(["!border-0", "border"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["!bg-transparent", "bg-blue-100"])).toBe(false);
    expect(hasVisibleTailwindRing(["!ring-0", "ring"])).toBe(false);
    expect(hasVisibleTailwindShadow(["!shadow-none", "shadow-lg"])).toBe(false);
    expect(hasVisibleTailwindFillOrEdge(["!bg-transparent", "!bg-blue-100"])).toBe(false);
    expect(hasVisibleTailwindRing(["!ring-0", "!ring"])).toBe(false);
  });
});
