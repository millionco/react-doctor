import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoDestructure } from "./solid-no-destructure.js";

describe("solid-no-destructure", () => {
  it("flags destructured props in function declaration component", () => {
    const result = runRule(
      solidNoDestructure,
      `function MyComponent({ name }) { return <div>{name}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("reactivity");
  });

  it("flags destructured props in arrow function component", () => {
    const result = runRule(
      solidNoDestructure,
      `const MyComponent = ({ name }) => <div>{name}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("reactivity");
  });

  it("flags destructured props in function expression component", () => {
    const result = runRule(
      solidNoDestructure,
      `const MyComponent = function({ name }) { return <div>{name}</div>; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows props accessed via property access", () => {
    const result = runRule(
      solidNoDestructure,
      `const MyComponent = (props) => <div>{props.name}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag functions with no parameters", () => {
    const result = runRule(solidNoDestructure, `const MyComponent = () => <div>hello</div>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag functions with multiple parameters", () => {
    const result = runRule(solidNoDestructure, `const helper = ({ a }, b) => <div>{a}</div>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag functions that return no JSX", () => {
    const result = runRule(solidNoDestructure, `const helper = ({ name }) => name.toUpperCase();`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag render prop callbacks", () => {
    const result = runRule(
      solidNoDestructure,
      `const App = () => <Show when={data()}>{({ item }) => <span>{item}</span>}</Show>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags destructured props with default values", () => {
    const result = runRule(
      solidNoDestructure,
      `const Card = ({ title = "Untitled" }) => <div>{title}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
