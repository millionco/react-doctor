import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNullishCoalescingArithmeticPrecedence } from "./no-nullish-coalescing-arithmetic-precedence.js";

describe("no-nullish-coalescing-arithmetic-precedence", () => {
  it("flags x ?? 0 / y", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = x ?? 0 / y;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a ?? 0 - b", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = a ?? 0 - b;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a ?? 10 * 60", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = a ?? 10 * 60;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the OpenOrders sort-comparator shape", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `list.sort((a, b) => b.at ?? 0 - (a.at ?? 0));`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chained left-spine numeric literal", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = a ?? 0 - b - c;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the parenthesized (x ?? 0) / y", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = (x ?? 0) / y;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a computed default with two identifiers", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = x ?? count - max;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a scaled default whose leftmost leaf is an identifier", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = x ?? carouselWidth * 5;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a call-expression fallback", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = x ?? Math.floor(y);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ?? mixed with a comparison", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = x ?? y > 0;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag string concatenation with a string literal", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = name ?? "" + suffix;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an explicitly parenthesized arithmetic fallback", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = x ?? (0 / y);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain ?? with a literal fallback", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = x ?? 0;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
