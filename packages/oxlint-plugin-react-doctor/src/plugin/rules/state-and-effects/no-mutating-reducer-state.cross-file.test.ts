import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { noMutatingReducerState } from "./no-mutating-reducer-state.js";

// Cross-file tests need actual files on disk so the rule's
// `resolveRelativeImportPath` / `parseSourceFile` plumbing can do
// its job. Each test creates a temp directory with the consumer
// file + one or more reducer files, runs the rule against the
// consumer, and asserts the diagnostic.

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "no-mutating-reducer-xfile-"));
  __clearParseSourceFileCacheForTests();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

describe("no-mutating-reducer-state — cross-file resolution", () => {
  it("flags a mutation through an imported named reducer", () => {
    writeFile(
      "reducer.ts",
      `
        export function reducer(state, action) {
          state.count++;
          return state;
        }
      `,
    );
    const consumerPath = writeFile(
      "App.tsx",
      `
        import { useReducer } from "react";
        import { reducer } from "./reducer";
        useReducer(reducer, { count: 0 });
      `,
    );

    const result = runRule(noMutatingReducerState, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a mutation through an imported default reducer", () => {
    writeFile(
      "reducer.ts",
      `
        export default function (state, action) {
          state.items.push(action.item);
          return state;
        }
      `,
    );
    const consumerPath = writeFile(
      "App.tsx",
      `
        import { useReducer } from "react";
        import reducer from "./reducer";
        useReducer(reducer, { items: [] });
      `,
    );

    const result = runRule(noMutatingReducerState, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a mutation through `export { reducer as default }` (rename-as-default pattern)", () => {
    writeFile(
      "reducer.ts",
      `
        function reducer(state, action) {
          state.flag = true;
          return state;
        }
        export { reducer as default };
      `,
    );
    const consumerPath = writeFile(
      "App.tsx",
      `
        import { useReducer } from "react";
        import reducer from "./reducer";
        useReducer(reducer, { flag: false });
      `,
    );

    const result = runRule(noMutatingReducerState, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an arrow-form reducer exported under a renamed binding", () => {
    writeFile(
      "reducer.ts",
      `
        const internalReducer = (state, action) => {
          state.flag = true;
          return state;
        };
        export { internalReducer as todoReducer };
      `,
    );
    const consumerPath = writeFile(
      "App.tsx",
      `
        import { useReducer } from "react";
        import { todoReducer } from "./reducer";
        useReducer(todoReducer, { flag: false });
      `,
    );

    const result = runRule(noMutatingReducerState, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows a barrel re-export to the underlying reducer", () => {
    writeFile(
      "reducers/todo.ts",
      `
        export function todoReducer(state, action) {
          state.items.push(action.item);
          return state;
        }
      `,
    );
    writeFile(
      "reducers/index.ts",
      `
        export { todoReducer } from "./todo";
      `,
    );
    const consumerPath = writeFile(
      "App.tsx",
      `
        import { useReducer } from "react";
        import { todoReducer } from "./reducers";
        useReducer(todoReducer, { items: [] });
      `,
    );

    const result = runRule(noMutatingReducerState, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows an `export *` barrel re-export", () => {
    writeFile(
      "reducers/todo.ts",
      `
        export function todoReducer(state, action) {
          state.count++;
          return state;
        }
      `,
    );
    writeFile(
      "reducers/index.ts",
      `
        export * from "./todo";
      `,
    );
    const consumerPath = writeFile(
      "App.tsx",
      `
        import { useReducer } from "react";
        import { todoReducer } from "./reducers";
        useReducer(todoReducer, { count: 0 });
      `,
    );

    const result = runRule(noMutatingReducerState, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a non-mutating imported reducer", () => {
    writeFile(
      "reducer.ts",
      `
        export function reducer(state, action) {
          return { ...state, count: state.count + 1 };
        }
      `,
    );
    const consumerPath = writeFile(
      "App.tsx",
      `
        import { useReducer } from "react";
        import { reducer } from "./reducer";
        useReducer(reducer, { count: 0 });
      `,
    );

    const result = runRule(noMutatingReducerState, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it("does not crash when the imported reducer file doesn't exist", () => {
    const consumerPath = writeFile(
      "App.tsx",
      `
        import { useReducer } from "react";
        import { reducer } from "./missing-file";
        useReducer(reducer, {});
      `,
    );

    const result = runRule(noMutatingReducerState, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it("anchors the diagnostic at the consumer's useReducer call (not the cross-file mutation node)", () => {
    writeFile(
      "reducer.ts",
      `
        export function reducer(state, action) {
          state.count++;
          return state;
        }
      `,
    );
    const consumerPath = writeFile(
      "App.tsx",
      `
        import { useReducer } from "react";
        import { reducer } from "./reducer";
        useReducer(reducer, { count: 0 });
      `,
    );

    const result = runRule(noMutatingReducerState, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.diagnostics).toHaveLength(1);
    // The reported node must be the consumer's CallExpression (i.e.
    // a CallExpression node from THIS file), NOT a mutation node
    // from the imported reducer's AST.
    expect(result.diagnostics[0].nodeType).toBe("CallExpression");
    expect(result.diagnostics[0].message).toContain("./reducer");
  });

  it("does not crash on a .d.ts-only declaration", () => {
    writeFile(
      "reducer.d.ts",
      `
        export declare function reducer(state: unknown, action: unknown): unknown;
      `,
    );
    const consumerPath = writeFile(
      "App.tsx",
      `
        import { useReducer } from "react";
        import { reducer } from "./reducer";
        useReducer(reducer, {});
      `,
    );

    const result = runRule(noMutatingReducerState, fs.readFileSync(consumerPath, "utf8"), {
      filename: consumerPath,
    });

    expect(result.diagnostics).toEqual([]);
  });
});
