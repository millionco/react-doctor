import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const coordinates = `import { useCallback } from "react";

type Vector = { horizontal: number; vertical: number };

const VectorMath = {
  sub(point: Vector, origin: Vector) {
    return {
      horizontal: point.horizontal - origin.horizontal,
      vertical: point.vertical - origin.vertical,
    };
  },
};

export function useTranslation() {
  const translate = useCallback((point: Vector, origin: Vector) => {
    const translation = VectorMath.sub(point, origin);
    return translation.horizontal + translation.vertical;
  }, []);
  return { translate };
}`;

const namespaceCoordinates = coordinates.replace(
  /const VectorMath = \{[\s\S]*?\n\};/,
  `namespace VectorMath {
  export function sub(point: Vector, origin: Vector) {
    return {
      horizontal: point.horizontal - origin.horizontal,
      vertical: point.vertical - origin.vertical,
    };
  }
}`,
);

describe("effect-needs-cleanup for subtraction methods", () => {
  it.each([
    ["a private object", coordinates],
    ["a private namespace", namespaceCoordinates],
  ])("accepts coordinate subtraction on %s", (_description, source) => {
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["a separate effect in the method", "    return {", "    connect(point); return {"],
    ["an exported object", "const VectorMath =", "export const VectorMath ="],
    ["an exported namespace", "namespace VectorMath", "export namespace VectorMath"],
    ["an aliased object", "export function", "registerMath(VectorMath); export function"],
    [
      "an aliased namespace",
      "export function useTranslation",
      "registerMath(VectorMath); export function useTranslation",
    ],
    ["a replaced method", "export function", "VectorMath.sub = replacement; export function"],
    [
      "a replaced namespace method",
      "export function useTranslation",
      "VectorMath.sub = replacement; export function useTranslation",
    ],
    [
      "a getter for the method",
      "  sub(point: Vector, origin: Vector) {",
      "  get sub() { return (point: Vector, origin: Vector) => {",
    ],
    [
      "an imported provider",
      "const VectorMath =",
      "import { VectorMath } from './arithmetic'; const fallback =",
    ],
    [
      "a merged namespace",
      "export function useTranslation",
      "namespace VectorMath { export const enabled = true; } export function useTranslation",
    ],
  ])("preserves the subscription warning with %s", (description, search, replacement) => {
    const input = description.includes("namespace") ? namespaceCoordinates : coordinates;
    let source = input.replace(search, replacement);
    if (description === "a getter for the method")
      source = source.replace("  },\n};", "  }; },\n};");
    expect(source).not.toBe(input);
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((row) => row.message.includes("`sub`"))).toBe(true);
  });
});
