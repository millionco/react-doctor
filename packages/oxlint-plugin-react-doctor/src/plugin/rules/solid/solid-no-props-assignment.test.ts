import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoPropsAssignment } from "./solid-no-props-assignment.js";

describe("solid-no-props-assignment", () => {
  it("flags direct prop assignment in function component", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const name = props.name; return <div>{name}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.name");
    expect(result.diagnostics[0].message).toContain("breaks Solid reactivity");
  });

  it("flags prop assignment in arrow component", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `const Comp = (props) => { const value = props.value; return <span>{value}</span>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.value");
  });

  it("flags multiple prop assignments", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const name = props.name; const age = props.age; return <div>{name}{age}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags nested prop access like props.user.name", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const name = props.user.name; return <div>{name}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.user.name");
  });

  it("flags prop used in a derived calculation", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const count = props.count; const doubled = count * 2; return <div>{doubled}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.count");
  });

  it("does not flag accessor wrapping via arrow function", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const name = () => props.name; return <div>{name()}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag direct JSX usage of props", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { return <div>{props.name}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag prop access inside a nested function", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const handler = () => { const v = props.value; doSomething(v); }; return <button onClick={handler} />; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-component function", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function helper(config) { const x = config.value; return x * 2; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag destructured props (covered by solid-no-destructure)", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp({ name }) { return <div>{name}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag assignment of non-prop value", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const x = 42; return <div>{x}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag prop access inside createEffect callback", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { createEffect(() => { const name = props.name; console.log(name); }); return <div />; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("suggests accessor syntax with correct variable name", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const title = props.title; return <h1>{title}</h1>; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("const title = () => props.title");
  });

  it("does not flag prop access inside event handler arrow function", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { return <button onClick={() => { const v = props.value; alert(v); }} />; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags prop assignment with items used in .map()", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const items = props.items; return <ul>{items.map(i => <li>{i}</li>)}</ul>; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.items");
  });

  it("flags independently in multiple components in the same file", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function A(props) { const x = props.x; return <div>{x}</div>; }
       function B(props) { const y = props.y; return <span>{y}</span>; }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag reassignment expression (only variable declarations)", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { let x; x = props.value; return <div>{x}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags array destructuring from prop member expression", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const [first] = props.items; return <div>{first}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("props.items");
  });

  it("does not flag optional chaining like props?.name (ChainExpression)", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const name = props?.name; return <div>{name}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag function call wrapping a prop access", () => {
    const result = runRule(
      solidNoPropsAssignment,
      `function Comp(props) { const name = String(props.name); return <div>{name}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
