import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateStoreInRender } from "./no-create-store-in-render.js";

describe("no-create-store-in-render", () => {
  it("flags zustand create inside a component", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { create } from "zustand";

      function App() {
        const useStore = create((set) => ({ count: 0 }));
        return null;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("zustand.create");
  });

  it("flags jotai atom inside an arrow component", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { atom } from "jotai";

      const Page = () => {
        const countAtom = atom(0);
        return null;
      };
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("jotai.atom");
  });

  it("flags valtio proxy inside a hook", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { proxy } from "valtio";

      function useTodos() {
        const state = proxy({ todos: [] });
        return state;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("valtio.proxy");
  });

  it("flags @reduxjs/toolkit configureStore inside a component", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { configureStore } from "@reduxjs/toolkit";

      function App() {
        const store = configureStore({ reducer: () => ({}) });
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("configureStore");
  });

  it("flags mobx makeAutoObservable inside a component", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { makeAutoObservable } from "mobx";

      function App() {
        const state = makeAutoObservable({ count: 0 });
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("makeAutoObservable");
  });

  it("flags nanostores atom inside a component", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { atom } from "nanostores";

      function App() {
        const $count = atom(0);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a store factory at module scope", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { create } from "zustand";
      import { atom } from "jotai";

      export const useStore = create((set) => ({ count: 0 }));
      export const countAtom = atom(0);

      function App() {
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag store factories inside plain helper functions", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { create } from "zustand";

      function makeStore() {
        return create((set) => ({ count: 0 }));
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag locally-named helpers that shadow the factory", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      function create(initializer) {
        return initializer();
      }

      function App() {
        const store = create(() => ({ count: 0 }));
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags renamed imports", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { create as makeStore } from "zustand";

      function App() {
        const useStore = makeStore((set) => ({ count: 0 }));
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `namespace.create(...)` when the namespace is imported from zustand", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import * as zustand from "zustand";

      function App() {
        const useStore = zustand.create((set) => ({ count: 0 }));
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("zustand.create");
  });

  it("flags `mobx.makeAutoObservable(...)` via a namespace import", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import * as mobx from "mobx";

      function App() {
        const state = mobx.makeAutoObservable({ count: 0 });
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("makeAutoObservable");
  });

  it("does not flag `random.create(...)` from a non-supported namespace import", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import * as random from "some-other-lib";

      function App() {
        const useStore = random.create((set) => ({ count: 0 }));
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag store factories from non-supported modules", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { create } from "some-other-lib";

      function App() {
        const store = create((set) => ({ count: 0 }));
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags store factory inside a memo()-wrapped named function component", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { memo } from "react";
      import { create } from "zustand";

      const App = memo(function App() {
        const store = create((set) => ({ count: 0 }));
        return null;
      });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags store factory inside a memo()-wrapped arrow component", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { memo } from "react";
      import { create } from "zustand";

      const App = memo(() => {
        const store = create((set) => ({ count: 0 }));
        return null;
      });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a store factory created inside an event handler", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { create } from "zustand";

      function App() {
        const onNew = () => {
          const store = create((set) => ({ count: 0 }));
          return store;
        };
        return null;
      }
    `,
    );

    // The handler runs on click, not on render — the store isn't
    // reallocated every render.
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a store factory created inside a useMemo callback", () => {
    const result = runRule(
      noCreateStoreInRender,
      `
      import { useMemo } from "react";
      import { create } from "zustand";

      function App() {
        const store = useMemo(() => create((set) => ({ count: 0 })), []);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
