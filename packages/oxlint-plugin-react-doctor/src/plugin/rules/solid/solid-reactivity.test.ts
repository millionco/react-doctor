import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidReactivity } from "./solid-reactivity.js";

describe("solid-reactivity", () => {
  describe("signal used without being called (badSignal)", () => {
    it("flags signal used in a template literal without calling it", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const [count, setCount] = createSignal(0);
         const message = \`Count: \${count}\`;`,
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("called as a function");
      expect(result.diagnostics[0].message).toContain("template literals");
    });

    it("flags signal used in arithmetic without calling it", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const [count, setCount] = createSignal(0);
         const doubled = count * 2;`,
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("arithmetic or comparisons");
    });

    it("flags signal used in comparison without calling it", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const [count, setCount] = createSignal(0);
         const isPositive = count > 0;`,
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("arithmetic or comparisons");
    });

    it("flags signal used in unary expression without calling it", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const [count, setCount] = createSignal(0);
         const negated = -count;`,
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("unary expressions");
    });

    it("flags signal used in JSX child without calling it on a DOM element", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const [count, setCount] = createSignal(0);
         const App = () => <div>{count}</div>;`,
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("called as a function");
      expect(result.diagnostics[0].message).toContain("JSX");
    });

    it("does not flag signal called as a function inside a tracked scope", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal, createEffect } from "solid-js";
         const [count, setCount] = createSignal(0);
         createEffect(() => {
           const message = \`Count: \${count()}\`;
         });`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("createMemo tracking", () => {
    it("flags memo used in template literal without calling it", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal, createMemo } from "solid-js";
         const [count, setCount] = createSignal(0);
         const doubled = createMemo(() => count() * 2);
         const message = \`Doubled: \${doubled}\`;`,
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("called as a function");
    });

    it("does not flag memo called as a function inside a tracked scope", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal, createMemo, createEffect } from "solid-js";
         const [count, setCount] = createSignal(0);
         const doubled = createMemo(() => count() * 2);
         createEffect(() => {
           const message = \`Doubled: \${doubled()}\`;
         });`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("props access outside tracked scope (untrackedReactive)", () => {
    it("flags props member access outside tracked scope", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const Component = (props) => {
           const value = props.name;
           return <div>{value}</div>;
         };`,
      );
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes("should be used within JSX"),
        ),
      ).toBe(true);
    });

    it("does not flag props used in JSX expression", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const Component = (props) => {
           return <div>{props.name}</div>;
         };`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag props.initialValue access", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const Component = (props) => {
           const [val, setVal] = createSignal(props.initialValue);
           return <div>{val()}</div>;
         };`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag props.defaultValue access", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const Component = (props) => {
           const [val, setVal] = createSignal(props.defaultValue);
           return <div>{val()}</div>;
         };`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("noWrite — no direct reassignment of reactive values", () => {
    it("flags direct reassignment of a signal accessor", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const [count, setCount] = createSignal(0);
         count = 5;`,
      );
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes("should not be reassigned"),
        ),
      ).toBe(true);
    });

    it("flags direct property assignment on a store", () => {
      const result = runRule(
        solidReactivity,
        `import { createStore } from "solid-js/store";
         const [store, setStore] = createStore({ count: 0 });
         store.count = 5;`,
      );
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes("should not be reassigned"),
        ),
      ).toBe(true);
    });
  });

  describe("noAsyncTrackedScope", () => {
    it("flags async function passed to createEffect", () => {
      const result = runRule(
        solidReactivity,
        `import { createEffect } from "solid-js";
         createEffect(async () => {
           await fetch("/api");
         });`,
      );
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.message.includes("should not be async")),
      ).toBe(true);
    });

    it("flags async function passed to createMemo", () => {
      const result = runRule(
        solidReactivity,
        `import { createMemo } from "solid-js";
         const data = createMemo(async () => {
           return await fetch("/api");
         });`,
      );
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.message.includes("should not be async")),
      ).toBe(true);
    });

    it("does not flag sync function passed to createEffect", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal, createEffect } from "solid-js";
         const [count, setCount] = createSignal(0);
         createEffect(() => {
           console.log(count());
         });`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag async function passed to onMount (called-function)", () => {
      const result = runRule(
        solidReactivity,
        `import { onMount } from "solid-js";
         onMount(async () => {
           await fetch("/api");
         });`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("tracked scopes — signals used in createEffect are valid", () => {
    it("does not flag signal used inside createEffect", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal, createEffect } from "solid-js";
         const [count, setCount] = createSignal(0);
         createEffect(() => {
           console.log(count());
         });`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag signal used in JSX expression container", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const [count, setCount] = createSignal(0);
         const App = () => <div>{count()}</div>;`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("import tracking", () => {
    it("does not flag when there is no solid-js import", () => {
      const result = runRule(
        solidReactivity,
        `const [count, setCount] = createSignal(0);
         const doubled = count * 2;`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });

    it("handles aliased imports", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal as cs } from "solid-js";
         const [count, setCount] = cs(0);
         const message = \`Count: \${count}\`;`,
      );
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("called as a function");
    });
  });

  describe("store / mergeProps / splitProps tracking", () => {
    it("flags store access outside tracked scope", () => {
      const result = runRule(
        solidReactivity,
        `import { createStore } from "solid-js/store";
         const [store, setStore] = createStore({ name: "hello" });
         const name = store.name;`,
      );
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    });

    it("flags mergeProps result used outside tracked scope", () => {
      const result = runRule(
        solidReactivity,
        `import { mergeProps } from "solid-js";
         const Component = (props) => {
           const merged = mergeProps({ name: "default" }, props);
           const val = merged.name;
           return <div>{val}</div>;
         };`,
      );
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("DOM event handler tracking", () => {
    it("does not flag signal used inside DOM event handler callback", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal } from "solid-js";
         const [count, setCount] = createSignal(0);
         const App = () => <button onClick={() => setCount(count())}>Click</button>;`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("batch / produce sync callbacks", () => {
    it("does not flag signal used in batch callback", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal, batch } from "solid-js";
         const [count, setCount] = createSignal(0);
         const [doubled, setDoubled] = createSignal(0);
         createEffect(() => {
           batch(() => {
             setCount(1);
             setDoubled(count() * 2);
           });
         });`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("on() helper", () => {
    it("does not flag signal passed to on() first arg", () => {
      const result = runRule(
        solidReactivity,
        `import { createSignal, createEffect, on } from "solid-js";
         const [count, setCount] = createSignal(0);
         createEffect(on(count, (value) => {
           console.log(value);
         }));`,
      );
      expect(result.diagnostics).toHaveLength(0);
    });
  });
});
