import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArithmeticOnOptionalChainedOperand } from "./no-arithmetic-on-optional-chained-operand.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "./no-array-find-result-member-access-without-guard.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";
import { noNonNullAssertionOnMaybeUndefinedResult } from "./no-non-null-assertion-on-maybe-undefined-result.js";
import { noNullishCoalescingArithmeticPrecedence } from "./no-nullish-coalescing-arithmetic-precedence.js";
import { noObjectKeysValuesEntriesOnMaybeUndefined } from "./no-object-keys-values-entries-on-maybe-undefined.js";
import { noPredicateFunctionReferenceInBooleanPosition } from "./no-predicate-function-reference-in-boolean-position.js";

const OPTIONAL_ARITHMETIC_STRESS_CASE_COUNT = 1_200;

describe("guard and optional access audit regressions", () => {
  it("does not retain an optional-chain presence proof after the root is written", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `export const format = (item?: { price: number }): string => {
         if (!item) return "";
         item = undefined;
         return (item?.price * 2).toFixed(2);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not retain an optional-chain presence proof after a member is written", () => {
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `export const format = (item?: { price?: number }): string => {
         if (!item?.price) return "";
         item.price = undefined;
         return (item?.price * 2).toFixed(2);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet on a userland find call with a member-expression query", () => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const filters = { active: { enabled: true } };
       declare const repository: { find: (query: object) => { name: string } };
       export const name = repository.find(filters.active).name;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags array find callbacks and consumers through TypeScript wrappers", () => {
    const callbackResult = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `declare const rows: Array<{ active: boolean; name: string }>;
       const isActive = (row: { active: boolean }): boolean => row.active;
       export const name = rows.find(isActive as typeof isActive).name;`,
    );
    const consumerResult = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `declare const rows: Array<{ active: boolean; name: string }>;
       export const name = (rows.find((row) => row.active) as { name: string }).name;`,
    );
    expect(callbackResult.diagnostics).toHaveLength(1);
    expect(consumerResult.diagnostics).toHaveLength(1);
  });

  it("does not use a global match guard to prove a second match element", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `export const second = (value: string): string =>
         value.match(/(a)/g) ? value.match(/(a)/g)[1].trim() : "";`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("respects regex guard polarity", () => {
    const safeResult = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `export const read = (value: string): string => {
         if (value.match(/a(b)/) === null) return "";
         return value.match(/a(b)/)[1].trim();
       };`,
    );
    const unsafeResult = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `export const read = (value: string): string => {
         if (value.match(/a(b)/) !== null) return "";
         return value.match(/a(b)/)[1].trim();
       };`,
    );
    expect(safeResult.diagnostics).toHaveLength(0);
    expect(unsafeResult.diagnostics).toHaveLength(1);
  });

  it("checks changedTouches and does not invert zero-length branches", () => {
    const changedTouchesResult = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `element.addEventListener("touchend", (event) => consume(event.changedTouches[0].clientX));`,
    );
    const zeroLengthResult = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `element.addEventListener("touchend", (event) => {
         if (event.touches.length === 0) consume(event.touches[0].clientX);
       });`,
    );
    expect(changedTouchesResult.diagnostics).toHaveLength(1);
    expect(zeroLengthResult.diagnostics).toHaveLength(1);
  });

  it("does not credit conditional or deferred Map writes", () => {
    const conditionalResult = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `export const read = (flag: boolean, key: string): number => {
         const values = new Map<string, number>();
         if (flag) values.set(key, 1);
         return values.get(key)!.valueOf();
       };`,
    );
    const deferredResult = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `export const read = (key: string): number => {
         const values = new Map<string, number>();
         const populate = (): void => { values.set(key, 1); };
         return values.get(key)!.valueOf();
       };`,
    );
    expect(conditionalResult.diagnostics).toHaveLength(1);
    expect(deferredResult.diagnostics).toHaveLength(1);
  });

  it("does not retain Map presence after delete or clear", () => {
    const deleteResult = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `export const read = (key: string): number => {
         const values = new Map<string, number>();
         values.set(key, 1);
         values.delete(key);
         return values.get(key)!.valueOf();
       };`,
    );
    const clearResult = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `export const read = (key: string): number => {
         const values = new Map<string, number>();
         values.set(key, 1);
         values.clear();
         return values.get(key)!.valueOf();
       };`,
    );
    expect(deleteResult.diagnostics).toHaveLength(1);
    expect(clearResult.diagnostics).toHaveLength(1);
  });

  it("does not retain Map presence after the lookup key is written", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `export const read = (initialKey: string, nextKey: string): number => {
         const values = new Map<string, number>();
         let key = initialKey;
         values.set(key, 1);
         key = nextKey;
         return values.get(key)!.valueOf();
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not use an unstable repeated predicate as a find proof", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `export const read = (rows: Array<{ name: string }>): string =>
         rows.some(() => Math.random() > 0.5)
           ? rows.find(() => Math.random() > 0.5)!.name
           : "";`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags named and Boolean find predicates", () => {
    const namedResult = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const isActive = (row: { active: boolean }): boolean => row.active;
       export const read = (rows: Array<{ active: boolean; name: string }>): string =>
         rows.find(isActive)!.name;`,
    );
    const booleanResult = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `export const read = (rows: Array<{ name: string } | null>): string =>
         rows.find(Boolean)!.name;`,
    );
    expect(namedResult.diagnostics).toHaveLength(1);
    expect(booleanResult.diagnostics).toHaveLength(1);
  });

  it("stays quiet on an exhaustive const tuple mapping", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `type Size = "small" | "large";
       const SIZES: [Size, number][] = [["small", 1], ["large", 2]];
       export const read = (size: Size): number => SIZES.find((entry) => entry[0] === size)![1];`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust an exhaustive tuple mapping after mutation", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `type Size = "small" | "large";
       const SIZES: [Size, number][] = [["small", 1], ["large", 2]];
       SIZES.pop();
       export const read = (size: Size): number => SIZES.find((entry) => entry[0] === size)![1];`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes compound nullish normalizations", () => {
    const nullishResult = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `export const keys = (value?: object): string[] => { value ??= {}; return Object.keys(value); };`,
    );
    const orResult = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `export const keys = (value?: object): string[] => { value ||= {}; return Object.keys(value); };`,
    );
    expect(nullishResult.diagnostics).toHaveLength(0);
    expect(orResult.diagnostics).toHaveLength(0);
  });

  it("does not retain an object presence proof after a write", () => {
    const result = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `export const keys = (value?: object): string[] => {
         if (!value) return [];
         value = undefined;
         return Object.keys(value);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not retain an optional member presence proof after a root or member write", () => {
    const rootWriteResult = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `export const keys = (data?: { rows?: object }): string[] => {
         if (!data?.rows) return [];
         data = {};
         return Object.keys(data?.rows);
       };`,
    );
    const memberWriteResult = runRule(
      noObjectKeysValuesEntriesOnMaybeUndefined,
      `export const keys = (data?: { rows?: object }): string[] => {
         if (!data?.rows) return [];
         data.rows = undefined;
         return Object.keys(data?.rows);
       };`,
    );
    expect(rootWriteResult.diagnostics).toHaveLength(1);
    expect(memberWriteResult.diagnostics).toHaveLength(1);
  });

  it("flags swallowed numeric fallbacks through TypeScript wrappers and bigint literals", () => {
    const wrappedResult = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `export const scale = (value?: number, divisor = 2): number => value ?? (0 as number) / divisor;`,
    );
    const bigintResult = runRule(
      noNullishCoalescingArithmeticPrecedence,
      `export const offset = (value?: bigint, amount = 1n): bigint => value ?? 0n + amount;`,
    );
    expect(wrappedResult.diagnostics).toHaveLength(1);
    expect(bigintResult.diagnostics).toHaveLength(1);
  });

  it("flags a Boolean alias used as a predicate reference", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `const hasValue = Boolean; export const run = (): void => { if (hasValue) consume(); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("analyzes many optional arithmetic bindings without rescanning the function per use", () => {
    const statements = Array.from(
      { length: OPTIONAL_ARITHMETIC_STRESS_CASE_COUNT },
      (_, index) => `const value${index} = item?.price * ${index + 1}; value${index}.toFixed(2);`,
    );
    const result = runRule(
      noArithmeticOnOptionalChainedOperand,
      `export const read = (item?: { price: number }): void => { ${statements.join("\n")} };`,
    );
    expect(result.diagnostics).toHaveLength(OPTIONAL_ARITHMETIC_STRESS_CASE_COUNT);
  });
});
