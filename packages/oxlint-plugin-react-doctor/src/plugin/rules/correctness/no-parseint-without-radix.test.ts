import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noParseintWithoutRadix } from "./no-parseint-without-radix.js";

describe("no-parseint-without-radix", () => {
  it("flags parseInt with a single string argument", () => {
    const result = runRule(noParseintWithoutRadix, `const n = parseInt(str);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Number.parseInt with a single argument", () => {
    const result = runRule(noParseintWithoutRadix, `const n = Number.parseInt(str);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags parseInt with a nullish-coalescing argument", () => {
    const result = runRule(noParseintWithoutRadix, `const n = parseInt(value ?? "");`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags parseInt inside a map callback", () => {
    const result = runRule(noParseintWithoutRadix, `const parts = arr.map((p) => parseInt(p));`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags parseInt on an env value with a fallback", () => {
    const result = runRule(
      noParseintWithoutRadix,
      `const port = parseInt(process.env.PORT || "3000");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag parseInt with an explicit numeric radix", () => {
    const result = runRule(noParseintWithoutRadix, `const n = parseInt(str, 10);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag parseInt with an identifier radix", () => {
    const result = runRule(noParseintWithoutRadix, `const n = parseInt(str, base);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag parseFloat", () => {
    const result = runRule(noParseintWithoutRadix, `const n = parseFloat(str);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Number coercion", () => {
    const result = runRule(noParseintWithoutRadix, `const n = Number(str);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag parseInt on a non-Number receiver", () => {
    const result = runRule(noParseintWithoutRadix, `const n = obj.parseInt(str);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a locally shadowed parseInt helper", () => {
    const result = runRule(
      noParseintWithoutRadix,
      `function parseInt(x) { return x; } const n = parseInt(str);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag parseInt inside a test file (test-noise)", () => {
    const result = runRule(
      noParseintWithoutRadix,
      `expect(parseInt(bar.getAttribute("tabindex"))).toEqual(1);`,
      { filename: "src/victory-bar.test.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
