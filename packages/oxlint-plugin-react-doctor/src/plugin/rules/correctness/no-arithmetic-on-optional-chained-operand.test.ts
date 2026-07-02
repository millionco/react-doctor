import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArithmeticOnOptionalChainedOperand } from "./no-arithmetic-on-optional-chained-operand.js";

describe("no-arithmetic-on-optional-chained-operand", () => {
  it("flags an optional-chained operand divided then formatted via a binding", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const share = entry?.points / total; share.toFixed(2);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a variable assigned from an optional chain multiplied and formatted", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const selectedPlanSize = priceSelected?.bytes; const total = selectedPlanSize * planLimit; total.toFixed(0);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an optional-chained operand in a comparison", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `if (config?.limit * factor < threshold) {}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an optional-chained operand inside a Math call argument", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const rounded = Math.round(lineRef?.clientHeight * index);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports only once when both operands are optional chains", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const ratio = a?.x / b?.y; ratio.toFixed(1);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag additive operators (string-concat / index math)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const lastIndex = items?.length - 1; lastIndex.toString();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the operand has a ?? fallback", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const pct = (file?.progress ?? 0) * 100; pct.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a binding has a ?? fallback in its initializer", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const p = file?.progress ?? 0; const pct = p * 100; pct.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an enclosing if narrows the same root", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `if (invoice) { const amount = invoice?.total * taxRate; amount.toFixed(2); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an && guard narrows the same root", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const price = product && (product?.unitPrice * qty).toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a ternary test narrows the same root", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const price = product ? (product?.unitPrice * qty).toFixed(2) : "0";`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an if guards the alias binding of a chain (real-world `const size = box?.width; if (size) {...}` idiom)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const size = box?.width;
      if (size) { const total = size * scale; total.toFixed(0); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a ternary test guards the alias binding (real-world `percent != null ? percent / 100 : undefined` idiom)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const percent = leadContext?.contextUsedPercent;
      const label = percent != null ? (percent / 100).toFixed(2) : undefined;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an && test guards the alias binding (real-world `x ? 0.9 * x : false` shape via &&)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const width = node?.width; const scaled = width && (0.9 * width).toFixed(1);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag after a preceding early-return guard on the chain root (real-world `if (!invoice) return null;` prelude)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Total({ invoice, taxRate }) {
        if (!invoice) return null;
        const amount = invoice?.total * taxRate;
        return amount.toFixed(2);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag after a preceding early-return guard on the alias binding (real-world `if (typeof value !== "number") return` prelude)', () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Chart({ box }) {
        const size = box?.width;
        if (typeof size !== "number") return null;
        const total = size * 2;
        return total.toFixed(0);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the result binding is NaN-clamped before the consumer (real-world `if (Number.isNaN(ratio)) ratio = 0;` clamp)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `let ratio = entry?.points / total;
      if (Number.isNaN(ratio)) ratio = 0;
      ratio.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the binding is reassigned only after the numeric consumer", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `let ratio = entry?.points / total;
      const label = ratio.toFixed(2);
      ratio = 0;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the binding is only compound-assigned before the consumer (NaN survives `*=`)", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `let ratio = entry?.points / total;
      ratio *= 2;
      ratio.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when only a shadowing inner binding of the same name is consumed", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Share({ entry, total, others }) {
        const share = entry?.points / total;
        return others.map((share) => share.toFixed(2));
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a consumer inside a nested closure without shadowing", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const share = entry?.points / total;
      const render = () => share.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an unguarded alias binding despite an unrelated preceding if", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `function Total({ invoice, taxRate, verbose }) {
        if (verbose) console.log("computing");
        const amount = invoice?.total * taxRate;
        return amount.toFixed(2);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an optional call form whose result is not the operand", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const label = stepNumberLabel?.(index * 1); label.toString();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when there is no numeric consumer downstream", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const offset = lineRef?.clientHeight * index;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag plain multiplication without an optional chain", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const area = width * height; area.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a computed optional index operand", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `const v = row?.[key] * factor; v.toFixed(2);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
