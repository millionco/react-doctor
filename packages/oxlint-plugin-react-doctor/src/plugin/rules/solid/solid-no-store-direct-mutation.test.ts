import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoStoreDirectMutation } from "./solid-no-store-direct-mutation.js";

describe("solid-no-store-direct-mutation", () => {
  it("flags direct property assignment on store proxy", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createStore } from "solid-js/store";
       const [store, setStore] = createStore({ count: 0 });
       store.count = 5;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("store");
    expect(result.diagnostics[0].message).toContain("setter function");
  });

  it("flags nested property assignment", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createStore } from "solid-js/store";
       const [state, setState] = createStore({ user: { name: "" } });
       state.user.name = "Alice";`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("state");
  });

  it("flags array property reassignment", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createStore } from "solid-js/store";
       const [store, setStore] = createStore({ items: [] });
       store.items = [1, 2, 3];`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags augmented assignment operators", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createStore } from "solid-js/store";
       const [store, setStore] = createStore({ count: 0 });
       store.count += 1;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags logical assignment operators", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createStore } from "solid-js/store";
       const [store, setStore] = createStore({ items: null });
       store.items ||= [];`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags store with only getter destructured", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createStore } from "solid-js/store";
       const [store] = createStore({ x: 0 });
       store.x = 1;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags multiple mutations in the same file", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createStore } from "solid-js/store";
       const [store, setStore] = createStore({ a: 0, b: "" });
       store.a = 1;
       store.b = "hello";`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags aliased createStore import", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createStore as makeStore } from "solid-js/store";
       const [store, setStore] = makeStore({ count: 0 });
       store.count = 5;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag setStore usage", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createStore } from "solid-js/store";
       const [store, setStore] = createStore({ count: 0 });
       setStore("count", 5);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag produce usage", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createStore, produce } from "solid-js/store";
       const [store, setStore] = createStore({ count: 0 });
       setStore(produce((s) => { s.count = 5; }));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag regular object mutation", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `const obj = { count: 0 };
       obj.count = 5;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createSignal destructuring", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createSignal } from "solid-js";
       const [count, setCount] = createSignal(0);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createMutable direct mutation", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createMutable } from "solid-js/store";
       const state = createMutable({ count: 0 });
       state.count = 5;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag without solid-js/store import", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `const [store, setStore] = createStore({ count: 0 });
       store.count = 5;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createStore from wrong module", () => {
    const result = runRule(
      solidNoStoreDirectMutation,
      `import { createStore } from "some-other-lib";
       const [store, setStore] = createStore({ count: 0 });
       store.count = 5;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
