import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInPlaceArrayMutationInUseMemo } from "./no-in-place-array-mutation-in-usememo.js";

describe("no-in-place-array-mutation-in-usememo", () => {
  it("flags sorting a query-cache array in useMemo", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const sorted = useMemo(() => data?.brands?.sort(cmp) ?? [], [data]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags sorting a Formik values array in useMemo", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const images = useMemo(() => values.images.sort((a, b) => a.order - b.order), [values]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags reversing a parent-owned array in useCallback", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const reverse = useCallback(() => props.rows.reverse(), [props.rows]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a spread-copy before sort", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const sorted = useMemo(() => [...data.brands].sort(cmp), [data]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a slice-copy before sort", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const sorted = useMemo(() => data.brands.slice().sort(cmp), [data]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag toSorted (non-mutating)", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const sorted = useMemo(() => data.brands.toSorted(cmp), [data]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare-identifier receiver from a fresh local array", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const sorted = useMemo(() => {
        const xs = items.filter((p) => p.active);
        xs.sort();
        return xs;
      }, [items]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fresh array from Object.keys", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const keys = useMemo(() => Object.keys(map).sort(), [map]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a .map() producing a fresh array before sort", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const sorted = useMemo(() => data.brands.map(f).sort(g), [data]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a member receiver whose root is a fresh local object", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const out = useMemo(() => {
        const local = { arr: [...src] };
        local.arr.push(x);
        return local;
      }, [src]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a member receiver rooted at a function-call local (groupBy)", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const sorted = useMemo(() => {
        const grouped = groupBy(data, k);
        return grouped.items.sort(cmp);
      }, [data]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag pushing onto a ref's current array (undo stack)", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const handle = useCallback(() => {
        undoStackRef.current.push(state);
        const prev = redoStackRef.current.pop();
      }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a mutating method on a keyed ref-current array", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const handle = useCallback(() => stacksRef.current[key].splice(index, 1), []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an optional-chained ref-current mutation", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const handle = useCallback(() => chartRef.current?.push(point), []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a mutating method outside a memo callback", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `function handler() {
        props.rows.sort(cmp);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
