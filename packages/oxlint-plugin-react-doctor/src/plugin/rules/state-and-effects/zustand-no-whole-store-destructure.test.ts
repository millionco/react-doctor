import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { zustandNoWholeStoreDestructure } from "./zustand-no-whole-store-destructure.js";

const run = (code: string) => runRule(zustandNoWholeStoreDestructure, code);

describe("zustand-no-whole-store-destructure", () => {
  it("reports a destructured bound store without a selector", () => {
    const result = run(`
      import { create } from "zustand";
      const useBearStore = create(() => ({ bears: 0, fish: 0 }));
      export const BearCounter = () => {
        const { bears } = useBearStore();
        return <span>{bears}</span>;
      };
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("every store update");
  });

  it("reports a whole store assigned before a property read", () => {
    const result = run(`
      import { create as createStoreHook } from "zustand";
      const useBearStore = createStoreHook(() => ({ bears: 0 }));
      function BearCounter() {
        const state = useBearStore();
        return <span>{state.bears}</span>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a curried typed create call", () => {
    const result = run(`
      import { create } from "zustand";
      interface BearState { bears: number }
      const useBearStore = create<BearState>()(() => ({ bears: 0 }));
      const BearCounter = () => <span>{useBearStore().bears}</span>;
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports createWithEqualityFn and immutable bound-store aliases", () => {
    const result = run(`
      import { createWithEqualityFn as createHook } from "zustand/traditional";
      const useOriginalStore = createHook(() => ({ bears: 0 }));
      const useBearStore = useOriginalStore;
      function BearCounter() {
        const { bears } = useBearStore();
        return <span>{bears}</span>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a namespace factory call", () => {
    const result = run(`
      import * as Zustand from "zustand";
      const useBearStore = Zustand.create(() => ({ bears: 0 }));
      function BearCounter() {
        return <span>{useBearStore().bears}</span>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports proven vanilla stores passed to useStore without a selector", () => {
    const result = run(`
      import { useStore } from "zustand";
      import { createStore as makeStore } from "zustand/vanilla";
      const bearStore = makeStore(() => ({ bears: 0 }));
      const storeAlias = bearStore;
      export function BearCounter() {
        const { bears } = useStore(storeAlias);
        return <span>{bears}</span>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports same-file stores created from imported creator functions", () => {
    const result = run(`
      import { create, createStore, useStore } from "zustand";
      import { creator } from "./creator";
      const useBearStore = create(creator);
      const bearStore = createStore(creator);
      export const BoundView = () => <span>{useBearStore().count}</span>;
      export const VanillaView = () => <span>{useStore(bearStore).count}</span>;
    `);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports traditional vanilla store hooks without a selector", () => {
    const result = run(`
      import { createStore } from "zustand/vanilla";
      import { useStoreWithEqualityFn as useTraditionalStore } from "zustand/traditional";
      const bearStore = createStore(() => ({ bears: 0 }));
      export function BearCounter() {
        const { bears } = useTraditionalStore(bearStore);
        return <span>{bears}</span>;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports inside a custom hook", () => {
    const result = run(`
      import { create } from "zustand";
      const useBearStore = create(() => ({ bears: 0 }));
      export const useBears = () => useBearStore();
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows bound-store calls with selectors", () => {
    const result = run(`
      import { create } from "zustand";
      const useBearStore = create(() => ({ bears: 0 }));
      export const BearCounter = () => {
        const bears = useBearStore((state) => state.bears);
        return <span>{bears}</span>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows vanilla useStore calls with selectors", () => {
    const result = run(`
      import { createStore, useStore } from "zustand";
      const bearStore = createStore(() => ({ bears: 0 }));
      export const BearCounter = () => {
        const bears = useStore(bearStore, (state) => state.bears);
        return <span>{bears}</span>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows traditional vanilla store hooks with selectors", () => {
    const result = run(`
      import { createStore } from "zustand/vanilla";
      import { useStoreWithEqualityFn } from "zustand/traditional";
      const bearStore = createStore(() => ({ bears: 0 }));
      export const BearCounter = () => {
        const bears = useStoreWithEqualityFn(bearStore, (state) => state.bears);
        return <span>{bears}</span>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows imported custom hooks even when their names look like stores", () => {
    const result = run(`
      import { useBearStore } from "./store";
      export const BearCounter = () => {
        const { bears } = useBearStore();
        return <span>{bears}</span>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows incomplete curried factories", () => {
    const result = run(`
      import { create } from "zustand";
      const makeBearStore = create();
      export const View = () => <span>{makeBearStore().count}</span>;
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows local lookalike hooks not created by Zustand", () => {
    const result = run(`
      const useBearStore = () => ({ bears: 0 });
      export const BearCounter = () => {
        const { bears } = useBearStore();
        return <span>{bears}</span>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows shadowed bound-store names", () => {
    const result = run(`
      import { create } from "zustand";
      const useBearStore = create(() => ({ bears: 0 }));
      export const BearCounter = () => {
        const useBearStore = () => ({ bears: 1 });
        const { bears } = useBearStore();
        return <span>{bears}</span>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows shadowed Zustand factory imports", () => {
    const result = run(`
      import { create } from "zustand";
      const makeBearCounter = (create) => {
        const useBearStore = create(() => () => ({ bears: 0 }));
        const BearCounter = () => <span>{useBearStore().bears}</span>;
        return BearCounter;
      };
      export const BearCounter = makeBearCounter((initializer) => initializer);
    `);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows unknown or imported vanilla stores", () => {
    const result = run(`
      import { useStore } from "zustand";
      import { bearStore } from "./store";
      export const BearCounter = ({ store }) => {
        const first = useStore(bearStore);
        const second = useStore(store);
        return <span>{first.bears + second.bears}</span>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows unknown functions named useStore", () => {
    const result = run(`
      const useStore = (store) => store;
      const bearStore = { bears: 0 };
      export const BearCounter = () => <span>{useStore(bearStore).bears}</span>;
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows whole-store reads outside render", () => {
    const result = run(`
      import { create } from "zustand";
      const useBearStore = create(() => ({ bears: 0 }));
      const snapshot = useBearStore.getState();
      const renderValue = () => useBearStore();
      export const BearCounter = () => <span>{snapshot.bears}</span>;
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows calls inside event and effect callbacks", () => {
    const result = run(`
      import { useEffect } from "react";
      import { create } from "zustand";
      const useBearStore = create(() => ({ bears: 0 }));
      export const BearCounter = () => {
        useEffect(() => { useBearStore(); }, []);
        const onClick = () => useBearStore();
        return <button onClick={onClick}>Bears</button>;
      };
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows direct calls in PascalCase factories without React evidence", () => {
    const result = run(`
      import { create } from "zustand";
      const useBearStore = create(() => ({ bears: 0 }));
      function BearAdapter() {
        const state = useBearStore();
        return { state };
      }
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows dynamically computed namespace factory properties", () => {
    const result = run(`
      import * as Zustand from "zustand";
      const factoryName = "create";
      const useBearStore = Zustand[factoryName](() => ({ bears: 0 }));
      export const BearCounter = () => <span>{useBearStore().bears}</span>;
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows mutable aliases", () => {
    const result = run(`
      import { create } from "zustand";
      const useOriginalStore = create(() => ({ bears: 0 }));
      let useBearStore = useOriginalStore;
      export const BearCounter = () => <span>{useBearStore().bears}</span>;
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows type-only factory imports", () => {
    const result = run(`
      import type { create } from "zustand";
      const useBearStore = create(() => ({ bears: 0 }));
      export const BearCounter = () => <span>{useBearStore().bears}</span>;
    `);
    expect(result.diagnostics).toHaveLength(0);
  });
});
