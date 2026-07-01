import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMutatingArrayMethodOnPropOrHookResult } from "./no-mutating-array-method-on-prop-or-hook-result.js";

describe("no-mutating-array-method-on-prop-or-hook-result", () => {
  it("flags .sort() on a destructured-prop member (Faire experiments shape)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function CustomExperimentListItem({ customExperiment }) {
        customExperiment.tags.sort();
        return null;
      }
      `
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .reverse() on a prop array (InsiderView shape)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function InsiderView({ memberships }) {
        memberships.reverse();
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .splice() on a prop array", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        items.splice(0, 1);
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .sort() on a hook-call result", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const data = useQuery();
        data.sort();
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .sort() on a destructured hook result", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const { rows } = useTableData();
        rows.reverse();
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag [...array].sort() copy-first", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const sorted = [...items].sort();
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag array.slice().sort() copy-first", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const sorted = items.slice().sort();
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag toSorted / toReversed immutable methods", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const a = items.toSorted();
        const b = items.toReversed();
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a locally-constructed array", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const local = [3, 1, 2];
        local.sort();
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain utility function's array parameter", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function sortInPlace(arr) {
        arr.sort();
        return arr;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an Immer produce draft parameter", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const next = produce(items, (draft) => {
          draft.sort();
        });
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useMutation callback parameter", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        useMutation((rows) => {
          rows.sort();
        });
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a binding whose name advertises mutability", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const mutableItems = items;
        mutableItems.sort();
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag splicing a ref's current array", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const stackRef = useRef([]);
        stackRef.current.splice(index, 1);
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reversing a keyed ref-current array", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const mapRef = useRef({});
        mapRef.current[collection].splice(index, 1);
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a sorted copy from spread bound to a variable", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const copy = [...items];
        copy.sort();
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
