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

  it("flags sorting inside React.useMemo", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const sorted = React.useMemo(() => values.images.sort(cmp), [values]);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags sorting a destructured props array in useMemo", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `function List({ items }) {
        const sorted = useMemo(() => items.sort(cmp), [items]);
        return sorted;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutating a useState-with-setter object array in useMemo", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `function List() {
        const [state, setState] = useState({ items: [] });
        const next = useMemo(() => state.items.sort(cmp), [state]);
        return next;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag mutation inside a useCallback body (event-time imperative code, not a memo derivation)", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const reverse = useCallback(() => props.rows.reverse(), [props.rows]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag react-router history.push navigation in useCallback", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const goHome = useCallback(() => props.history.push("/home"), [props.history]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag GTM dataLayer command-queue push in a handler", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const track = useCallback(() => { window.dataLayer.push({ event: "click" }); }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a global command-queue push (Matomo _paq) even inside useMemo", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const tracked = useMemo(() => window._paq.push(["trackEvent", name]), [name]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a setter-less useState stable mutable container (subscription registry)", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `function useSensors() {
        const [subscribers] = useState({ onPointerDown: [] });
        const registry = useMemo(() => {
          subscribers.onPointerDown.unshift(callback);
          return subscribers;
        }, [callback]);
        return registry;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare-identifier render-local declared outside the memo", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `function List({ rows }) {
        const filtered = rows.filter(isActive);
        const sorted = useMemo(() => filtered.sort(cmp), [filtered]);
        return sorted;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("does not flag pushing onto a ref's current array inside useMemo", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const snapshot = useMemo(() => {
        historyRef.current.push(state);
        return historyRef.current.length;
      }, [state]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a mutating method on a keyed ref-current array", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const trimmed = useMemo(() => stacksRef.current[key].splice(index, 1), [key, index]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an optional-chained ref-current mutation", () => {
    const result = runRule(
      noInPlaceArrayMutationInUseMemo,
      `const appended = useMemo(() => chartRef.current?.push(point), [point]);`,
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
