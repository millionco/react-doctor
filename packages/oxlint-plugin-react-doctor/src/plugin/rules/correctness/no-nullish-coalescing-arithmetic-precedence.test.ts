import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNullishCoalescingArithmeticPrecedence } from "./no-nullish-coalescing-arithmetic-precedence.js";

describe("no-nullish-coalescing-arithmetic-precedence", () => {
  it("does not flag the `?? 0 - fn()` negation-fallback idiom (timezone-offset shape)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const offset = offsetInMinutes ?? 0 - new Date(isoDate).getTimezoneOffset();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags `?? 0 - y + z` (multi-term arithmetic swallowing the fallback)", () => {
    const result = runRule(noNullishCoalescingArithmeticPrecedence, `const r = x ?? 0 - y + z;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags x ?? 0 / y", () => {
    const result = runRule(noNullishCoalescingArithmeticPrecedence, `const r = x ?? 0 / y;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a ?? 0 - b", () => {
    const result = runRule(noNullishCoalescingArithmeticPrecedence, `const r = a ?? 0 - b;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("subtracts from");
  });

  it("flags the comparator swallow with a -1 fallback (indexOf/priority sentinel)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `list.sort((a, b) => a.priority ?? -1 - (b.priority ?? -1));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the OpenOrders sort-comparator shape", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `list.sort((a, b) => b.at ?? 0 - (a.at ?? 0));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chained left-spine numeric literal", () => {
    const result = runRule(noNullishCoalescingArithmeticPrecedence, `const r = a ?? 0 - b - c;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the parenthesized (x ?? 0) / y", () => {
    const result = runRule(noNullishCoalescingArithmeticPrecedence, `const r = (x ?? 0) / y;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a computed default with two identifiers", () => {
    const result = runRule(noNullishCoalescingArithmeticPrecedence, `const r = x ?? count - max;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a scaled default whose leftmost leaf is an identifier", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = x ?? carouselWidth * 5;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a call-expression fallback", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = x ?? Math.floor(y);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ?? mixed with a comparison", () => {
    const result = runRule(noNullishCoalescingArithmeticPrecedence, `const r = x ?? y > 0;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag string concatenation with a string literal", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const r = name ?? "" + suffix;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a numeric fallback used only for string concatenation", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const result = value ?? 0 + "px";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a swallowed zero fallback before an arbitrary call", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const result = total ?? 0 - discount();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags exponentiation swallowing a zero fallback", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const result = value ?? 0 ** exponent;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an explicitly parenthesized arithmetic fallback", () => {
    const result = runRule(noNullishCoalescingArithmeticPrecedence, `const r = x ?? (0 / y);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain ?? with a literal fallback", () => {
    const result = runRule(noNullishCoalescingArithmeticPrecedence, `const r = x ?? 0;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fully-constant unit-math default (60 * 1000 ms poll interval)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const pollInterval = props.interval ?? 60 * 1000;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fully-constant bytes default (100 * 1024 * 1024 upload cap)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const cap = maxUploadBytes ?? 100 * 1024 * 1024;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fully-constant default with a negated literal operand", () => {
    const result = runRule(noNullishCoalescingArithmeticPrecedence, `const r = a ?? -1 * 60;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a literal coefficient times a unit constant (5 * MINUTE_MS)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `import { MINUTE_MS } from "./constants"; const staleTime = options.staleTimeMs ?? 5 * MINUTE_MS;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a literal coefficient times a namespaced unit (30 * Day.seconds)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const refreshTokenLifetime = toOptionalNumber(env.REFRESH_TOKEN_LIFETIME) ?? 30 * Day.seconds;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an inner-parenthesized equal-share percent ((1 / n) * 100)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const widthPercent = columnWidthPercent ?? (1 / columnCount) * 100;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an equal-share fraction default (1 / n)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `nextSizes.push(sizeList[idx] ?? 1 / node.children.length);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a months-to-year scaling of a call result (12 * fn())", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const annualPrice = annualProduct?.price ?? 12 * minimumTransactionAmount(currency);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the full-circle canvas default (2 * Math.PI)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `context.arc(centerX, centerY, radius, 0, endAngle ?? 2 * Math.PI);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a computed percent fallback (100 * loaded / total)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const percent = props.value ?? 100 * bytesLoaded / bytesTotal;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an exponential-backoff fallback (2 ** attempt * base)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const delayMs = retryAfterMs ?? 2 ** attempt * BASE_RETRY_DELAY_MS;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a complement-percent fallback (100 - successRate)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const errorRate = Math.max(0, Math.min(100, workflow.errorPropagation?.errorRate ?? 100 - successRate));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a swallowed identity coefficient (1 * y)", () => {
    const result = runRule(noNullishCoalescingArithmeticPrecedence, `const r = x ?? 1 * y;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the explicit -1 coefficient negation (-1 * gutter)", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const offset = marginOverride ?? -1 * gutter;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parenthesized fraction inside an outer addition", () => {
    const result = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `const total = basePadding + (columnGap ?? 1 / columnCount);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
