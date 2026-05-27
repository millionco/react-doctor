import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoSignalFromProp } from "./solid-no-signal-from-prop.js";

describe("solid-no-signal-from-prop", () => {
  it("flags createSignal(props.value) in a function component", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Child(props) { const [val, setVal] = createSignal(props.value); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.value");
    expect(result.diagnostics[0].message).toContain("reads the prop once");
  });

  it("flags createSignal(props.name) in an arrow function component", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       const Child = (props) => { const [val] = createSignal(props.name); return <div>{val()}</div>; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.name");
  });

  it("flags createSignal(props.count) with setter destructured", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp(props) { const [count, setCount] = createSignal(props.count); return <span>{count()}</span>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.count");
  });

  it("flags createSignal(props.items) for array props", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp(props) { const [items] = createSignal(props.items); return <ul>{items()}</ul>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.items");
  });

  it("flags nested prop access like props.config.value", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp(props) { const [x] = createSignal(props.config.value); return <div>{x()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.config.value");
  });

  it("flags aliased createSignal import", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal as cs } from "solid-js";
       function Comp(props) { const [val] = cs(props.value); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.value");
  });

  it("does not flag createSignal with a literal argument", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp() { const [val, setVal] = createSignal(0); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createSignal with a string literal argument", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp() { const [val, setVal] = createSignal("hello"); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createSignal with a function call argument", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp(props) { const [val, setVal] = createSignal(getDefault()); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag in a non-component function (no JSX)", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function helper(config) { const [val] = createSignal(config.x); return val; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag createSignal with a local variable argument", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp(props) { const initial = 0; const [val] = createSignal(initial); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag in a render prop callback", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       const items = [1, 2, 3];
       const el = <List each={items}>{(item) => { const [val] = createSignal(item.count); return <span>{val()}</span>; }}</List>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag without a solid-js import", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `function Comp(props) { const [val] = createSignal(props.value); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags component with multiple params (props is first)", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp(props, context) { const [val] = createSignal(props.value); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags independently in multiple components in the same file", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function A(props) { const [a] = createSignal(props.x); return <div>{a()}</div>; }
       function B(props) { const [b] = createSignal(props.y); return <span>{b()}</span>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags computed property access like props['value']", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp(props) { const [val] = createSignal(props["value"]); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag optional chaining like props?.value (ChainExpression)", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp(props) { const [val] = createSignal(props?.value); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when root object is a function call like getProps().value", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp(props) { const [val] = createSignal(getProps().value); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when first param has a default value", () => {
    const result = runRule(
      solidNoSignalFromProp,
      `import { createSignal } from "solid-js";
       function Comp(props = {}) { const [val] = createSignal(props.value); return <div>{val()}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
