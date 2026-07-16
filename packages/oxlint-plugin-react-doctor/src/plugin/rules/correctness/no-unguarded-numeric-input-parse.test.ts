import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedNumericInputParse } from "./no-unguarded-numeric-input-parse.js";

describe("no-unguarded-numeric-input-parse", () => {
  it("flags Number(e.target.value) in an input onChange", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number(e.target.value))} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a radix-carrying parseInt(e.target.value, 10) in an input onChange", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(parseInt(e.target.value, 10))} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags parseFloat(e.currentTarget.value)", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onInput={(e) => save(parseFloat(e.currentTarget.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Number.parseInt(e.target.value, 10)", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number.parseInt(e.target.value, 10))} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a radix-less parseInt now that no-parseint-without-radix is retired", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(parseInt(e.target.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a radix-less Number.parseInt now that no-parseint-without-radix is retired", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number.parseInt(e.target.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a coercion of e.target.valueAsNumber", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number(e.target.valueAsNumber))} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a ternary-guarded coercion", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(e.target.value ? Number(e.target.value) : undefined)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an isNaN-guarded coercion", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(isNaN(e.target.valueAsNumber) ? undefined : Number.parseInt(e.target.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ||-fallback coercion", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number(e.target.value) || 0)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a coercion sourced from a select onChange", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <select onChange={(e) => setX(Number(e.target.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a coercion on a component prop handler", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <Pagination onRowsPerPageChange={(e) => setPageSize(Number(e.target.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a coercion of option.value", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number(option.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the element type cannot be resolved", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const handleChange = (e) => setX(Number(e.target.value));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the canonical slider idiom: Number(e.target.value) on <input type='range'>", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input type="range" min={0} max={100} onChange={(e) => setVolume(Number(e.target.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a radio input whose value is a fixed numeric literal", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input type="radio" value="2" checked={x === 2} onChange={(e) => setX(Number(e.target.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a range input whose type is an expression-container string literal", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input type={"range"} onInput={(e) => setBlur(Number(e.currentTarget.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a type='number' field, whose .value is '' for partial input so NaN is unreachable", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input type="number" value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a type='number' field when the type attribute follows the handler", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(event) => setRowHeight(Number(event.target.value))} type="number" value={rowHeight} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a wrapper-nested parse whose binding is isNaN-guarded on the next line", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input type="text" onChange={(e) => {
        const v = Math.max(1, Math.min(100000, Math.floor(Number(e.target.value))));
        if (!isNaN(v)) update("games", v);
      }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a wrapper-nested parse with no guard on its binding", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input type="text" onChange={(e) => {
        const v = Math.floor(Number(e.target.value));
        update("games", v);
      }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an unguarded coercion in a multi-statement type='text' handler", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input type="text" maxLength={3} value={totalUsers} onChange={(e) => {
        e.preventDefault();
        setDisableApplyButton(false);
        setTotalUsers(Number(e.target.value));
      }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an unguarded parseInt on a type='text' field", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input type="text" value={\`\${rows}\`} onChange={(e) => setRows(parseInt(e.target.value, 10))} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an input whose type is a dynamic expression", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input type={inputType} onChange={(e) => setX(Number(e.target.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the empty-check early-return idiom before the parse", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => {
        if (e.target.value === "") return;
        setX(Number(e.target.value));
      }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a && short-circuit whose left operand checks the value", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => e.target.value !== "" && setX(Number(e.target.value))} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the parse-then-Number.isNaN-gate idiom the rule itself recommends", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => {
        const next = Number(e.target.value);
        if (!Number.isNaN(next)) setX(next);
      }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a stored parse gated by a Number.isFinite ternary", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => {
        const next = parseFloat(e.target.value);
        setX(Number.isFinite(next) ? next : fallback);
      }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the only if-statement in the handler is unrelated to the value", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => {
        if (isOpen) trackEvent();
        setX(Number(e.target.value));
      }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the type attribute resolves to a sanitized const", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const AMOUNT_INPUT_TYPE = "number";
      const AmountField = ({ onAmount }) => (
        <input type={AMOUNT_INPUT_TYPE} onChange={(e) => onAmount(Number(e.target.value))} />
      );`,
      { filename: "amount.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a digit-strip replace before the parse", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const QtyField = ({ setQty }) => (
        <input type="text" onChange={(e) => setQty(Number(e.target.value.replace(/\\D/g, "")))} />
      );`,
      { filename: "qty.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an || fallback short-circuit", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const QtyField = ({ setQty }) => (
        <input type="text" onChange={(e) => setQty(Number(e.target.value) || 1)} />
      );`,
      { filename: "qty.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
