import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMutatingReducerState } from "./no-mutating-reducer-state.js";

describe("no-mutating-reducer-state", () => {
  it("flags direct property mutation followed by returning the same reducer state", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        state.age = state.age + 1;
        return state;
      }

      useReducer(reducer, { age: 0 });
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("same reference");
  });

  it("flags array mutator calls on inline reducers", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import * as React from "react";

      React.useReducer((state, action) => {
        state.todos.push(action.todo);
        return state;
      }, []);
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags aliased reducer state mutation and aliased return", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer as useReactReducer } from "react";

      const reducer = (state, action) => {
        const next = state;
        next.name = action.name;
        return next;
      };

      useReactReducer(reducer, { name: "" });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags compound and update expressions before same-reference returns", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        if (action.type === "inc") {
          state.count += 1;
          return state;
        }
        if (action.type === "dec") {
          state.count--;
          return state;
        }
        return state;
      }

      useReducer(reducer, { count: 0 });
    `,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags mutations in branch conditions before same-reference returns", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        if (state.count++ > action.limit) {
          return state;
        }
        return { ...state, count: action.limit };
      }

      useReducer(reducer, { count: 0 });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags returning the result of in-place state array methods", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      useReducer((state, action) => {
        return state.sort((a, b) => a.id - b.id);
      }, []);
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat nested array mutator returns as top-level same-reference returns", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      useReducer((state, action) => {
        return state.items.sort((a, b) => a.id - b.id);
      }, { items: [] });
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags destructured-alias mutations when the same reducer state is returned", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        const { items } = state;
        items.push(action.item);
        return state;
      }

      useReducer(reducer, { items: [] });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags renamed destructured aliases", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        const { items: rows } = state;
        rows.sort(compareNodes);
        return state;
      }

      useReducer(reducer, { items: [] });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags array-destructured aliases reachable from state", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        const [firstItem] = state.items;
        firstItem.flag = true;
        return state;
      }

      useReducer(reducer, { items: [] });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag destructured aliases sourced from a fresh array (slice / spread)", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        const [...rest] = state.items;
        rest.push(action.item);
        return { ...state, items: rest };
      }

      useReducer(reducer, { items: [] });
    `,
    );

    // RestElement off a destructure is a fresh array (slice copy at
    // runtime), so the rule should NOT treat \`rest\` as reachable.
    expect(result.diagnostics).toEqual([]);
  });

  it("flags nested aliases into reducer state when the original state is returned", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import React from "react";

      function reducer(state, action) {
        const items = state.items;
        items.push(action.item);
        return state;
      }

      React.useReducer(reducer, { items: [] });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags same-reference returns hidden inside conditional expressions", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        state.count++;
        return action.keep ? state : { ...state };
      }

      useReducer(reducer, { count: 0 });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags same-reference mutations through parenthesized and TypeScript wrappers", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      type State = { count: number; items: string[] };

      function reducer(state: State, action) {
        if (action.type === "count") {
          state.count++;
          return state as State;
        }

        state.items!.push(action.item);
        return (state);
      }

      useReducer(reducer, { count: 0, items: [] });
    `,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags collection mutators when the same state reference is returned", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function mapReducer(state, action) {
        state.set(action.key, action.value);
        return state;
      }

      function setReducer(state, action) {
        state.add(action.value);
        return state;
      }

      useReducer(mapReducer, new Map());
      useReducer(setReducer, new Set());
    `,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags `_.set(state, path, value)` from the mutating lodash package", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";
      import _ from "lodash";

      function reducer(state, action) {
        _.set(state, action.path, action.value);
        return state;
      }

      useReducer(reducer, { user: {} });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `set(state, ...)` from `lodash/set`", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";
      import set from "lodash/set";

      function reducer(state, action) {
        set(state, action.path, action.value);
        return state;
      }

      useReducer(reducer, {});
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `_.merge(state, source)` from lodash-es", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";
      import * as _ from "lodash-es";

      function reducer(state, action) {
        _.merge(state, action.patch);
        return state;
      }

      useReducer(reducer, {});
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag `_.set(state, ...)` when imported from `lodash/fp` (non-mutating)", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";
      import _ from "lodash/fp";

      function reducer(state, action) {
        // lodash/fp.set returns a new value — discarding the result is wasteful
        // but not a same-state-mutation bug.
        _.set(action.path, action.value, state);
        return state;
      }

      useReducer(reducer, {});
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a custom non-lodash `set` import", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";
      import { set } from "./my-custom-set";

      function reducer(state, action) {
        set(state, action.path, action.value);
        return state;
      }

      useReducer(reducer, {});
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag `Object.assign` when Object is shadowed in the file", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";
      import { Object } from "./my-safe-utils";

      function reducer(state, action) {
        Object.assign(state, action.patch);
        return state;
      }

      useReducer(reducer, {});
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag `Reflect.set` when Reflect is shadowed in the file", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";
      const Reflect = customReflect;

      function reducer(state, action) {
        Reflect.set(state, action.key, action.value);
        return state;
      }

      useReducer(reducer, {});
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags standard object mutation APIs before same-reference returns", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        if (action.type === "assign") {
          Object.assign(state, action.patch);
          return state;
        }
        if (action.type === "reflect") {
          Reflect.set(state, action.key, action.value);
          return state;
        }
        return state;
      }

      useReducer(reducer, {});
    `,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("handles static and dynamic computed mutating method names", () => {
    const staticResult = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        if (action.type === "array") {
          state.items["push"](action.item);
          return state;
        }

        Object["assign"](state, action.patch);
        return state;
      }

      useReducer(reducer, { items: [] });
    `,
    );

    const dynamicResult = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        const push = action.method;
        const assign = action.assignMethod;

        if (action.type === "array") {
          state.items[push](action.item);
          return state;
        }

        Object[assign](state, action.patch);
        return state;
      }

      useReducer(reducer, { items: [] });
    `,
    );

    expect(staticResult.diagnostics).toHaveLength(2);
    expect(dynamicResult.diagnostics).toHaveLength(0);
  });

  it("flags switch fallthrough from mutation into same-reference return", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        switch (action.type) {
          case "mutate":
            state.count++;
          case "done":
            return state;
          default:
            return { ...state };
        }
      }

      useReducer(reducer, { count: 0 });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not carry switch mutations across break boundaries", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        switch (action.type) {
          case "mutate":
            state.count++;
            break;
          case "done":
            return state;
          default:
            return state;
        }

        return { ...state };
      }

      useReducer(reducer, { count: 0 });
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ordinary no-op return branches", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function dropdownReducer(state, action) {
        switch (action.type) {
          case "START_SAVE":
            return state.activeAction === "idle"
              ? { ...state, activeAction: { type: "saving" } }
              : state;
          default:
            return state;
        }
      }

      useReducer(dropdownReducer, { activeAction: "idle" });
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags logical assignment before a same-reference no-op guard", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        state.activeNode ??= action.node;

        if (state.nodes.includes(action.node)) {
          return state;
        }

        state.nodes.push(action.node);
        state.nodes.sort(compareNodes);

        return { ...state };
      }

      useReducer(reducer, { nodes: [] });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag mutation in one branch when that branch returns a fresh object", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        if (action.type === "add") {
          state.items.push(action.item);
          return { ...state, changed: true };
        }

        return state;
      }

      useReducer(reducer, { items: [] });
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag clone-first object or array mutations", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        if (action.type === "remove") {
          const next = { ...state };
          delete next.items[action.id];
          return next;
        }
        if (action.type === "move") {
          const nextItems = [...state.items];
          nextItems.splice(action.from, 1);
          return { ...state, items: nextItems };
        }
        if (action.type === "slice") {
          const nextItems = state.items.slice();
          nextItems.push(action.item);
          return { ...state, items: nextItems };
        }
        if (action.type === "arrayFrom") {
          const nextItems = Array.from(state.items);
          nextItems.reverse();
          return { ...state, items: nextItems };
        }
        return state;
      }

      useReducer(reducer, { items: [] });
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag standard object APIs when mutating a fresh target", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        const next = Object.assign({}, state, action.patch);
        Reflect.set(next, action.key, action.value);
        return next;
      }

      useReducer(reducer, {});
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag clone-first Map mutations", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      const groupReducer = (state, action) => {
        const newState = new Map(state);

        switch (action.type) {
          case "register":
            newState.set(action.id, { visible: action.visible });
            return newState;
          case "unregister":
            newState.delete(action.id);
            return newState;
          default:
            return state;
        }
      };

      useReducer(groupReducer, new Map());
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag nested mutation when returning a new top-level wrapper", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        switch (action.type) {
          case "surface":
            state.screens[state.activeScreen].payload.surface = action.payload;
            return { ...state };
          case "mount":
            state.replayerCleanup.set(action.replayer, action.cleanup);
            return { ...state, replayers: [...state.replayers, action.replayer] };
          default:
            return state;
        }
      }

      useReducer(reducer, {
        activeScreen: "one",
        screens: { one: { payload: {} } },
        replayerCleanup: new Map(),
        replayers: [],
      });
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag shallow-clone writes through the clone identifier", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        const newState = { ...state };
        if (typeof newState[action.relationTo] !== "object") {
          newState[action.relationTo] = {};
        }
        newState[action.relationTo][action.id] = action.doc;
        return newState;
      }

      useReducer(reducer, {});
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Array.reduce accumulators or locally shadowed useReducer", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      items.reduce((state, item) => {
        state.push(item);
        return state;
      }, []);

      function useReducer(reducer, initialState) {
        return [initialState, reducer];
      }

      function reducer(state, action) {
        state.count++;
        return state;
      }

      useReducer(reducer, { count: 0 });
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-React or shadowed useReducer calls", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer as useStoreReducer } from "not-react";
      import { useReducer } from "react";

      function reducer(state, action) {
        state.count++;
        return state;
      }

      function Component() {
        const useReducer = (reducer, initialState) => [initialState, reducer];
        useReducer(reducer, { count: 0 });
      }

      useStoreReducer(reducer, { count: 0 });
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Immer-backed reducer wrappers", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";
      import { produce } from "immer";
      import { useImmerReducer } from "use-immer";

      useReducer(produce((state, action) => {
        state.count++;
      }), { count: 0 });

      useImmerReducer((state, action) => {
        state.count++;
        return state;
      }, { count: 0 });
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag nested function or block-local state shadowing", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        function helper(state) {
          state.count++;
          return state;
        }

        {
          const state = { count: 0 };
          state.count++;
        }

        return state;
      }

      useReducer(reducer, { count: 0 });
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag state after it is rebound to a fresh object", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        state = { ...state };
        state.count++;
        return state;
      }

      useReducer(reducer, { count: 0 });
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves state rebinding and var aliases across standalone blocks", () => {
    const rebound = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        {
          state = { ...state };
        }

        state.count++;
        return state;
      }

      useReducer(reducer, { count: 0 });
    `,
    );

    const varAlias = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        {
          var alias = state;
        }

        alias.count++;
        return alias;
      }

      useReducer(reducer, { count: 0 });
    `,
    );

    expect(rebound.diagnostics).toHaveLength(0);
    expect(varAlias.diagnostics).toHaveLength(1);
  });

  it("skips imported reducers when the importing file isn't on disk (no filename context)", () => {
    // runRule without a filename can't resolve relative imports.
    // Cross-file resolution is intentionally a no-op in that case
    // so unit fixtures don't accidentally read random files on disk.
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";
      import { reducer } from "./reducer";

      useReducer(reducer, {});
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("skips reducers imported from a non-relative path (node_modules — not user's code)", () => {
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";
      import { reducer } from "some-package";

      useReducer(reducer, {});
    `,
      { filename: "/tmp/fixture.tsx" },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("terminates on a reducer with many sequential branches (path-state cap)", () => {
    // Each non-returning \`if\` forks the analyzer's path states; without
    // a cap this 2^N explosion would hang. The cap bails safely.
    const sequentialIfs = Array.from(
      { length: 40 },
      (_unused, index) =>
        `if (action["k${index}"] !== undefined) next.v${index} = action["k${index}"];`,
    ).join("\n        ");
    const result = runRule(
      noMutatingReducerState,
      `
      import { useReducer } from "react";

      function reducer(state, action) {
        const next = { ...state };
        ${sequentialIfs}
        return next;
      }

      function App() {
        const [state, dispatch] = useReducer(reducer, {});
        return null;
      }
    `,
    );

    // \`next\` is a fresh clone, so there's no real mutation-of-original
    // bug here — the point is the analyzer completes without hanging.
    expect(result.parseErrors).toEqual([]);
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});
