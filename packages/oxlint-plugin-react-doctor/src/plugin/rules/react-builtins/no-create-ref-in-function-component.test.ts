import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";

describe("no-create-ref-in-function-component", () => {
  it("flags an observed `createRef()` in a function-declaration component", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `function App() { const ref = createRef(); globalThis.observedRef = ref; return <div ref={ref} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useRef");
  });

  it("flags an observed `createRef()` in an arrow-function component", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `const App = () => { const ref = createRef(); globalThis.observedRef = ref; return <div ref={ref} />; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an observed `React.createRef()` via the namespace", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `function App() { const ref = React.createRef(); globalThis.observedRef = ref; return <div ref={ref} />; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `createRef()` in a custom hook", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `function useThing() { const ref = createRef(); return ref; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag `createRef()` as a class field", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `class C extends React.Component { ref = createRef(); render() { return null; } }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `createRef()` inside a class method", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `class C extends React.Component { render() { const ref = createRef(); return null; } }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `createRef()` at module scope", () => {
    const result = runRule(noCreateRefInFunctionComponent, `const sharedRef = createRef();`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `createRef()` in a non-component helper function", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `function setup() { const ref = createRef(); return ref; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `createRef()` in a PascalCase factory that returns no JSX", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `function MakeStore() { return { ref: createRef() }; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a local `createRef` that shadows React's (scope-safe)", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `function App() { const createRef = () => ({ current: null }); const ref = createRef(); return <div ref={ref} />; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `useRef()`", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `function App() { const ref = useRef(null); return <div ref={ref} />; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
