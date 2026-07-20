import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { zustandNoFreshSelectorResult } from "./zustand-no-fresh-selector-result.js";

const expectDiagnosticCount = (code: string, count: number): void => {
  const result = runRule(zustandNoFreshSelectorResult, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

describe("zustand-no-fresh-selector-result", () => {
  it("requires a declared Zustand v5 dependency", () => {
    expect(zustandNoFreshSelectorResult.requires).toEqual(["zustand", "zustand:5"]);
  });

  it("flags object, array, and function literals returned by a create-bound store", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create((set) => ({ bears: [], count: 0 }));
        const summary = useBearStore((state) => ({ count: state.count }));
        const pair = useBearStore((state) => [state.count, state.bears]);
        const fallback = useBearStore((state) => state.action ?? (() => {}));
      `,
      3,
    );
  });

  it("flags known allocating selector transforms", () => {
    expectDiagnosticCount(
      `
        import { create as makeStore } from "zustand";
        const useBearStore = makeStore()(() => ({ bears: [], byId: new Map() }));
        const active = useBearStore((state) => state.bears.filter((bear) => bear.active));
        const names = useBearStore((state) => state.bears.map((bear) => bear.name));
        const keys = useBearStore((state) => Object.keys(state.byId));
        const sortedEntries = useBearStore((state) => Object.entries(state.byId).toSorted());
        const copied = useBearStore((state) => Array.from(state.byId.keys()));
      `,
      5,
    );
  });

  it("recognizes a store completed through a split curried factory", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        interface BearState { bears: string[] }
        const makeBearStore = create<BearState>();
        const useBearStore = makeBearStore(() => ({ bears: [] }));
        const names = useBearStore((state) => state.bears.map(formatBear));
      `,
      1,
    );
  });

  it("does not infer allocating array methods from user-defined method names", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const stableValue = {};
        const useStore = create(() => ({
          index: { map: () => stableValue },
          values: makeValues(),
        }));
        const custom = useStore((state) => state.index.map());
        const unknown = useStore((state) => state.values.filter(isValue));
      `,
      0,
    );
  });

  it("still reports fresh literals for stores created from imported creators", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { creator } from "./creator";
        const useStore = create(creator);
        const summary = useStore((state) => ({ count: state.count }));
      `,
      1,
    );
  });

  it("flags fresh instances and fresh chains", () => {
    expectDiagnosticCount(
      `
        import * as Zustand from "zustand";
        const useBearStore = Zustand.create(() => ({ bears: [] }));
        const lookup = useBearStore((state) => new Map(state.bears.map((bear) => [bear.id, bear])));
        const ordered = useBearStore((state) => state.bears.filter(isBear).sort(compareBears));
      `,
      2,
    );
  });

  it("flags fresh results in block returns without entering nested functions", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create(() => ({ bears: [], compact: false }));
        const result = useBearStore((state) => {
          const active = state.bears.filter((bear) => bear.active);
          function deferred() { return { active }; }
          if (state.compact) return active;
          return state.bears;
        });
      `,
      1,
    );
  });

  it("flags fresh results through transparent and result-preserving wrappers", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create(() => ({ bears: [], compact: false }));
        const first = useBearStore((state) => (state.compact ? ({ count: state.bears.length } as const) : state.bears));
        const second = useBearStore((state) => (state.compact && state.bears.map((bear) => bear.id)));
        const third = useBearStore((state) => (track(state), [state.bears] satisfies unknown[]));
      `,
      3,
    );
  });

  it("does not report a truthy fresh left operand that cannot be returned by logical AND", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create(() => ({ bears: [], fallback: null }));
        const stable = useBearStore((state) => ({ bears: state.bears } && state.bears));
        const fresh = useBearStore((state) => state.fallback && ({ bears: state.bears }));
      `,
      1,
    );
  });

  it("follows immutable local selector results and same-file selector references", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create(() => ({ bears: [] }));
        const selectActive = (state) => {
          const activeBears = state.bears.filter((bear) => bear.active);
          return activeBears;
        };
        const active = useBearStore(selectActive);
      `,
      1,
    );
  });

  it("does not follow mutable function, variable, or parameter-default selector aliases", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create(() => ({ bears: [], label: "" }));
        let mutableSelector = (state) => ({ bears: state.bears });
        mutableSelector = (state) => state.bears;
        const first = useBearStore(mutableSelector);
        function reassignedSelector(state) { return { bears: state.bears }; }
        reassignedSelector = (state) => state.bears;
        const second = useBearStore(reassignedSelector);
        const readWithDefault = (selector = (state) => ({ bears: state.bears })) =>
          useBearStore(selector);
      `,
      0,
    );
  });

  it("does not classify string slice and concat results as fresh arrays", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create(() => ({ label: "bears" }));
        const prefix = useBearStore((state) => state.label.slice(0, 2));
        const decorated = useBearStore((state) => state.label.concat("!"));
      `,
      0,
    );
  });

  it("supports same-file bound-hook aliases", () => {
    expectDiagnosticCount(
      `
        import create from "zustand";
        const useBearStore = create(() => ({ count: 0 }));
        const useAliasedStore = useBearStore;
        const value = useAliasedStore((state) => ({ count: state.count }));
      `,
      1,
    );
  });

  it("flags fresh selectors passed to the vanilla useStore hook", () => {
    expectDiagnosticCount(
      `
        import { useStore as useVanillaStore } from "zustand";
        import { bearStore } from "./bear-store";
        const summary = useVanillaStore(bearStore, (state) => ({ count: state.count }));
      `,
      1,
    );
  });

  it("flags useStoreWithEqualityFn only when no equality function is supplied", () => {
    expectDiagnosticCount(
      `
        import { useStoreWithEqualityFn } from "zustand/traditional";
        import { shallow } from "zustand/shallow";
        import { bearStore } from "./bear-store";
        const unsafe = useStoreWithEqualityFn(bearStore, (state) => [state.count, state.bears]);
        const safe = useStoreWithEqualityFn(bearStore, (state) => [state.count, state.bears], shallow);
      `,
      1,
    );
  });

  it("does not treat ignored equality arguments on v5 APIs as stabilization", () => {
    expectDiagnosticCount(
      `
        import { create, useStore } from "zustand";
        import { shallow } from "zustand/shallow";
        import { bearStore } from "./bear-store";
        const useBearStore = create(() => ({ count: 0 }));
        const bound = useBearStore((state) => ({ count: state.count }), shallow);
        const vanilla = useStore(bearStore, (state) => ({ count: state.count }), shallow);
      `,
      2,
    );
  });

  it("allows selectors wrapped by an imported useShallow alias", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { useShallow as stabilize } from "zustand/react/shallow";
        const useBearStore = create(() => ({ count: 0, bears: [] }));
        const value = useBearStore(stabilize((state) => ({ count: state.count, bears: state.bears })));
      `,
      0,
    );
  });

  it("allows useShallow from the compatibility shallow entry point", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { useShallow } from "zustand/shallow";
        const useBearStore = create(() => ({ count: 0, bears: [] }));
        const value = useBearStore(useShallow((state) => [state.count, state.bears]));
      `,
      0,
    );
  });

  it("respects an equality function held by a shadowing undefined binding", () => {
    expectDiagnosticCount(
      `
        import { useStoreWithEqualityFn } from "zustand/traditional";
        import { shallow } from "zustand/shallow";
        import { bearStore } from "./bear-store";
        function readStore(undefined = shallow) {
          return useStoreWithEqualityFn(
            bearStore,
            (state) => ({ count: state.count }),
            undefined,
          );
        }
      `,
      0,
    );
  });

  it("treats void equality arguments as missing", () => {
    expectDiagnosticCount(
      `
        import { useStoreWithEqualityFn } from "zustand/traditional";
        import { bearStore } from "./bear-store";
        const value = useStoreWithEqualityFn(
          bearStore,
          (state) => ({ count: state.count }),
          void getEquality(),
        );
      `,
      1,
    );
  });

  it("allows a useShallow selector stored in a local binding", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { useShallow } from "zustand/react/shallow";
        const useBearStore = create(() => ({ count: 0, bears: [] }));
        const selectSummary = useShallow((state) => ({ count: state.count, bears: state.bears }));
        const value = useBearStore(selectSummary);
      `,
      0,
    );
  });

  it("allows explicit equality on bound traditional stores", () => {
    expectDiagnosticCount(
      `
        import { createWithEqualityFn } from "zustand/traditional";
        import { shallow } from "zustand/shallow";
        const useBearStore = createWithEqualityFn(() => ({ count: 0, bears: [] }));
        const value = useBearStore((state) => ({ count: state.count, bears: state.bears }), shallow);
      `,
      0,
    );
  });

  it("allows createWithEqualityFn stores with a default equality function", () => {
    expectDiagnosticCount(
      `
        import { createWithEqualityFn } from "zustand/traditional";
        import { shallow } from "zustand/shallow";
        const useBearStore = createWithEqualityFn()(() => ({ count: 0, bears: [] }), shallow);
        const value = useBearStore((state) => ({ count: state.count, bears: state.bears }));
      `,
      0,
    );
  });

  it("allows stable selector results and transforms after the hook", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create(() => ({ count: 0, bears: [] }));
        const count = useBearStore((state) => state.count);
        const bears = useBearStore((state) => state.bears).filter((bear) => bear.active);
        const length = useBearStore((state) => state.bears.map((bear) => bear.id).length);
        const csv = useBearStore((state) => state.bears.map((bear) => bear.id).join(","));
      `,
      0,
    );
  });

  it("allows stable module-scope fallback collections", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const EMPTY = [];
        const useBearStore = create(() => ({ bears: null }));
        const bears = useBearStore((state) => state.bears ?? EMPTY);
      `,
      0,
    );
  });

  it("skips imported project-specific bound hooks without provenance", () => {
    expectDiagnosticCount(
      `
        import { useBearStore } from "./bear-store";
        const value = useBearStore((state) => ({ count: state.count }));
      `,
      0,
    );
  });

  it("skips unknown helper calls and interprocedural selector wrappers", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create(() => ({ bears: [] }));
        const first = useBearStore((state) => memoizedSelection(state.bears));
        const second = useBearStore(withEquality((state) => ({ bears: state.bears })));
      `,
      0,
    );
  });

  it("does not trust same-named imports from other modules", () => {
    expectDiagnosticCount(
      `
        import { create, useStore } from "other-state";
        const useBearStore = create(() => ({ count: 0 }));
        const first = useBearStore((state) => ({ count: state.count }));
        const second = useStore(store, (state) => [state.count]);
      `,
      0,
    );
  });

  it("does not trust shadowed create, bound hooks, useStore, or useShallow bindings", () => {
    expectDiagnosticCount(
      `
        import { create, useStore } from "zustand";
        import { useShallow } from "zustand/react/shallow";
        const useBearStore = create(() => ({ count: 0 }));
        function Example(create, useStore, useShallow) {
          const useBearStore = create(() => ({ count: 0 }));
          useBearStore((state) => ({ count: state.count }));
          useStore(store, (state) => ({ count: state.count }));
          return useBearStore(useShallow((state) => ({ count: state.count })));
        }
      `,
      0,
    );
  });

  it("does not treat shadowed Object and Array helpers as allocating built-ins", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create(() => ({ bears: [] }));
        function Example(Object, Array) {
          const first = useBearStore((state) => Object.keys(state.bears));
          const second = useBearStore((state) => Array.from(state.bears));
          return [first, second];
        }
      `,
      0,
    );
  });

  it("does not treat dynamic computed methods or same-reference methods as fresh", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create(() => ({ bears: [] }));
        const dynamic = useBearStore((state) => state.bears[state.method]());
        const sorted = useBearStore((state) => state.bears.sort(compareBears));
        const reversed = useBearStore((state) => state.bears.reverse());
      `,
      0,
    );
  });

  it("does not report fresh values produced only inside nested callbacks", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useBearStore = create(() => ({ bears: [] }));
        const value = useBearStore((state) => {
          state.bears.forEach((bear) => { return { bear }; });
          return state.bears;
        });
      `,
      0,
    );
  });

  it("handles React useCallback selectors but not shadowed or unrelated wrappers", () => {
    expectDiagnosticCount(
      `
        import { useCallback as cacheSelector } from "react";
        import { create } from "zustand";
        const useBearStore = create(() => ({ bears: [] }));
        const selector = cacheSelector((state) => ({ bears: state.bears }), []);
        const first = useBearStore(selector);
        function Example(cacheSelector) {
          const second = useBearStore(cacheSelector((state) => ({ bears: state.bears }), []));
          return second;
        }
      `,
      1,
    );
  });

  it("recognizes supported React runtime useCallback forms", () => {
    expectDiagnosticCount(
      `
        import { useCallback as preactUseCallback } from "preact/hooks";
        import { create } from "zustand";
        const useBearStore = create(() => ({ bears: [] }));
        const callbackAlias = preactUseCallback;
        const first = useBearStore(callbackAlias((state) => ({ bears: state.bears }), []));
        const second = useBearStore(React.useCallback((state) => [state.bears], []));
      `,
      2,
    );
  });
});
