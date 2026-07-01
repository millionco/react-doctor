import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUndefinedOnlyGuardOnNullBearingValue } from "./no-undefined-only-guard-on-null-bearing-value.js";

describe("no-undefined-only-guard-on-null-bearing-value", () => {
  it("flags a ternary whose present branch calls toString on a null-bearing value", () => {
    const result = runRule(
      noUndefinedOnlyGuardOnNullBearingValue,
      `function render(value: string | null | undefined) {
        const displayValue = value === undefined ? '' : value.toString();
        return displayValue;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an if (x !== undefined) branch that reads a member of a null-bearing value", () => {
    const result = runRule(
      noUndefinedOnlyGuardOnNullBearingValue,
      `function nameOf(user: User | null | undefined) {
        if (user !== undefined) {
          return user.name;
        }
        return 'anon';
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an if (x === undefined) else branch that dereferences the value", () => {
    const result = runRule(
      noUndefinedOnlyGuardOnNullBearingValue,
      `function sizeOf(list: Collection | null | undefined) {
        if (list === undefined) {
          return 0;
        } else {
          return list.count();
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the branch only assigns/forwards the value", () => {
    const result = runRule(
      noUndefinedOnlyGuardOnNullBearingValue,
      `function apply(region: string | null | undefined, body: any) {
        if (region !== undefined) body.region = region;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fallback ternary that never dereferences a null value", () => {
    const result = runRule(
      noUndefinedOnlyGuardOnNullBearingValue,
      `function resolve(anchorElement: Element | null | undefined, anchorRef: any) {
        const anchor = anchorElement === undefined ? anchorRef?.current : anchorElement;
        return anchor;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an operand whose declared type does not include null", () => {
    const result = runRule(
      noUndefinedOnlyGuardOnNullBearingValue,
      `function read(value: number | undefined) {
        if (value !== undefined) {
          return value.toString();
        }
        return '';
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a deliberate null-vs-undefined split", () => {
    const result = runRule(
      noUndefinedOnlyGuardOnNullBearingValue,
      `function handle(value: string | null | undefined) {
        return value === null ? sendNull() : value === undefined ? omit() : setField(value);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the present branch re-guards with optional chaining", () => {
    const result = runRule(
      noUndefinedOnlyGuardOnNullBearingValue,
      `function render(value: User | null | undefined) {
        if (value !== undefined) {
          return value?.name;
        }
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when there is no type annotation to prove nullability", () => {
    const result = runRule(
      noUndefinedOnlyGuardOnNullBearingValue,
      `function render(value) {
        return value === undefined ? '' : value.toString();
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a member-expression operand (not a bare identifier)", () => {
    const result = runRule(
      noUndefinedOnlyGuardOnNullBearingValue,
      `function read(ref: { current: number | undefined }) {
        if (ref.current !== undefined) {
          return ref.current.toString();
        }
        return '';
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
