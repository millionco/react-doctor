import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jotaiSelectAtomInRenderBody } from "./jotai-select-atom-in-render-body.js";

describe("jotai-select-atom-in-render-body", () => {
  it("flags selectAtom in a component body (FunctionDeclaration)", () => {
    const code = `
      import { selectAtom } from "jotai/utils";
      function MyComponent() {
        const sliceAtom = selectAtom(baseAtom, (state) => state.foo);
        const value = useAtomValue(sliceAtom);
        return value;
      }
    `;
    const result = runRule(jotaiSelectAtomInRenderBody, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useMemo");
  });

  it("flags selectAtom in a component body (ArrowFunctionExpression)", () => {
    const code = `
      import { selectAtom } from "jotai/utils";
      const MyComponent = () => {
        const sliceAtom = selectAtom(baseAtom, (state) => state.foo);
        return useAtomValue(sliceAtom);
      };
    `;
    const result = runRule(jotaiSelectAtomInRenderBody, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags selectAtom in a custom hook body", () => {
    const code = `
      import { selectAtom } from "jotai/utils";
      function useFoo() {
        const sliceAtom = selectAtom(baseAtom, (state) => state.foo);
        return useAtomValue(sliceAtom);
      }
    `;
    const result = runRule(jotaiSelectAtomInRenderBody, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags selectAtom imported from 'jotai' (re-export)", () => {
    const code = `
      import { selectAtom } from "jotai";
      function MyComponent() {
        const sliceAtom = selectAtom(baseAtom, (state) => state.foo);
        return useAtomValue(sliceAtom);
      }
    `;
    const result = runRule(jotaiSelectAtomInRenderBody, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags selectAtom imported under an alias", () => {
    const code = `
      import { selectAtom as makeSlice } from "jotai/utils";
      function MyComponent() {
        const sliceAtom = makeSlice(baseAtom, (state) => state.foo);
        return useAtomValue(sliceAtom);
      }
    `;
    const result = runRule(jotaiSelectAtomInRenderBody, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags selectAtom inside a helper nested in a component", () => {
    const code = `
      import { selectAtom } from "jotai/utils";
      function MyComponent() {
        const buildSlice = () => selectAtom(baseAtom, (state) => state.foo);
        const sliceAtom = buildSlice();
        return useAtomValue(sliceAtom);
      }
    `;
    const result = runRule(jotaiSelectAtomInRenderBody, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag selectAtom at module scope", () => {
    const code = `
      import { selectAtom } from "jotai/utils";
      const sliceAtom = selectAtom(baseAtom, (state) => state.foo);
      function MyComponent() {
        return useAtomValue(sliceAtom);
      }
    `;
    const result = runRule(jotaiSelectAtomInRenderBody, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag selectAtom inside useMemo callback in a component", () => {
    const code = `
      import { selectAtom } from "jotai/utils";
      function MyComponent({ field }) {
        const sliceAtom = useMemo(
          () => selectAtom(baseAtom, (state) => state[field]),
          [field]
        );
        return useAtomValue(sliceAtom);
      }
    `;
    const result = runRule(jotaiSelectAtomInRenderBody, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag selectAtom inside useMemo callback in a custom hook", () => {
    const code = `
      import { selectAtom } from "jotai/utils";
      function useSlice(field) {
        const sliceAtom = useMemo(
          () => selectAtom(baseAtom, (s) => s[field]),
          [field]
        );
        return useAtomValue(sliceAtom);
      }
    `;
    const result = runRule(jotaiSelectAtomInRenderBody, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag selectAtom imported from a non-jotai source (homegrown helper)", () => {
    const code = `
      import { selectAtom } from "./my-utils";
      function MyComponent() {
        const sliceAtom = selectAtom(baseAtom, (state) => state.foo);
        return useAtomValue(sliceAtom);
      }
    `;
    const result = runRule(jotaiSelectAtomInRenderBody, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag selectAtom in a lowercase non-hook helper", () => {
    const code = `
      import { selectAtom } from "jotai/utils";
      function buildSliceAtom() {
        return selectAtom(baseAtom, (state) => state.foo);
      }
    `;
    const result = runRule(jotaiSelectAtomInRenderBody, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
