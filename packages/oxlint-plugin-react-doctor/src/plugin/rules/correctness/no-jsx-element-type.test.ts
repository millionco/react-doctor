import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noJsxElementType } from "./no-jsx-element-type.js";

describe("no-jsx-element-type", () => {
  it("flags function declaration with JSX.Element return type", () => {
    const result = runRule(
      noJsxElementType,
      `
      function App(): JSX.Element {
        return <div />;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("JSX.Element");
  });

  it("flags arrow function with JSX.Element return type", () => {
    const result = runRule(
      noJsxElementType,
      `
      const App = (): JSX.Element => <div />;
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("JSX.Element");
  });

  it("flags const arrow function with block body", () => {
    const result = runRule(
      noJsxElementType,
      `
      const App = (): JSX.Element => {
        return <div />;
      };
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags let arrow function with JSX.Element return type", () => {
    const result = runRule(
      noJsxElementType,
      `
      let App = (): JSX.Element => <div />;
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags var arrow function with JSX.Element return type", () => {
    const result = runRule(
      noJsxElementType,
      `
      var App = (): JSX.Element => <div />;
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags function expression with JSX.Element return type", () => {
    const result = runRule(
      noJsxElementType,
      `
      const App = function(): JSX.Element {
        return <div />;
      };
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags function declaration overload signature", () => {
    const result = runRule(
      noJsxElementType,
      `
      declare function App(props: { variant: "a" }): JSX.Element;
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags function with parameters and JSX.Element return type", () => {
    const result = runRule(
      noJsxElementType,
      `
      function Button({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
        return <button onClick={onClick}>{label}</button>;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags multiple functions each with JSX.Element", () => {
    const result = runRule(
      noJsxElementType,
      `
      function Header(): JSX.Element {
        return <header />;
      }
      const Footer = (): JSX.Element => <footer />;
    `,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag React.ReactNode return type", () => {
    const result = runRule(
      noJsxElementType,
      `
      import React from "react";
      function App(): React.ReactNode {
        return <div />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag React.ReactElement return type", () => {
    const result = runRule(
      noJsxElementType,
      `
      import React from "react";
      function App(): React.ReactElement {
        return <div />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag React.JSX.Element return type", () => {
    const result = runRule(
      noJsxElementType,
      `
      import React from "react";
      function App(): React.JSX.Element {
        return <div />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag no return type annotation", () => {
    const result = runRule(
      noJsxElementType,
      `
      function App() {
        return <div />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag string return type", () => {
    const result = runRule(
      noJsxElementType,
      `
      function getName(): string {
        return "hello";
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag void return type", () => {
    const result = runRule(
      noJsxElementType,
      `
      function doSomething(): void {
        console.log("done");
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag JSX.Element in a variable type annotation (not return type)", () => {
    const result = runRule(
      noJsxElementType,
      `
      const element: JSX.Element = <div />;
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still flags JSX.Element even with a shadowed local JSX namespace", () => {
    const result = runRule(
      noJsxElementType,
      `
      namespace JSX {
        interface Element {}
      }
      function App(): JSX.Element {
        return <div />;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
