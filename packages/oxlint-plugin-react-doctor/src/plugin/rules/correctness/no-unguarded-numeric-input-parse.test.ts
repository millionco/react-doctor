import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedNumericInputParse } from "./no-unguarded-numeric-input-parse.js";

describe("no-unguarded-numeric-input-parse", () => {
  it("flags Number(e.target.value) in an input onChange", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number(e.target.value))} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a radix-carrying parseInt(e.target.value, 10) in an input onChange", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(parseInt(e.target.value, 10))} />;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags parseFloat(e.currentTarget.value)", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onInput={(e) => save(parseFloat(e.currentTarget.value))} />;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Number.parseInt(e.target.value, 10)", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number.parseInt(e.target.value, 10))} />;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a radix-less parseInt already owned by no-parseint-without-radix", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(parseInt(e.target.value))} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a radix-less Number.parseInt already owned by no-parseint-without-radix", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number.parseInt(e.target.value))} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a coercion of e.target.valueAsNumber", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number(e.target.valueAsNumber))} />;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a ternary-guarded coercion", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(e.target.value ? Number(e.target.value) : undefined)} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an isNaN-guarded coercion", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(isNaN(e.target.valueAsNumber) ? undefined : Number.parseInt(e.target.value))} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ||-fallback coercion", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number(e.target.value) || 0)} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a coercion sourced from a select onChange", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <select onChange={(e) => setX(Number(e.target.value))} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a coercion on a component prop handler", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <Pagination onRowsPerPageChange={(e) => setPageSize(Number(e.target.value))} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a coercion of option.value", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const F = () => <input onChange={(e) => setX(Number(option.value))} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the element type cannot be resolved", () => {
    const result = runRule(
      noUnguardedNumericInputParse,
      `const handleChange = (e) => setX(Number(e.target.value));`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
