import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preactNoRenderArguments } from "./preact-no-render-arguments.js";

describe("preact-no-render-arguments", () => {
  it("flags `render(props)` on a class extending Component", () => {
    const result = runRule(
      preactNoRenderArguments,
      `
      import { Component } from "preact";

      class Hello extends Component {
        render(props) {
          return <h1>Hello {props.name}</h1>;
        }
      }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`render(props, state)`");
    // The shape is *not* deprecated — the Preact docs ship it as a
    // "Features unique to Preact" item. The rule reframes the smell as
    // hard-to-type / breaks-under-compat / inconsistent-with-other-
    // lifecycle-methods. Regression guard against the previous wording.
    expect(result.diagnostics[0].message).not.toContain("deprecated");
  });

  it("flags `render(props, state)` on a class extending `Preact.Component` (namespace import)", () => {
    const result = runRule(
      preactNoRenderArguments,
      `
      import * as Preact from "preact";

      class Header extends Preact.Component {
        render(props) {
          return <h1>{props.title}</h1>;
        }
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `render(props)` on a class extending `Preact.PureComponent`", () => {
    const result = runRule(
      preactNoRenderArguments,
      `
      import * as Preact from "preact";

      class Pure extends Preact.PureComponent {
        render(props) {
          return <span>{props.label}</span>;
        }
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `render(props, state)` on a class extending React.Component", () => {
    const result = runRule(
      preactNoRenderArguments,
      `
      import * as React from "preact/compat";

      class Counter extends React.Component {
        render(props, state) {
          return <span>{state.count}</span>;
        }
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a parameterless `render()`", () => {
    const result = runRule(
      preactNoRenderArguments,
      `
      import { Component } from "preact";

      class Hello extends Component {
        render() {
          return <h1>Hello {this.props.name}</h1>;
        }
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag classes that are not component classes", () => {
    const result = runRule(
      preactNoRenderArguments,
      `
      class Renderer {
        render(target) {
          return target.toString();
        }
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag function components named `render`", () => {
    const result = runRule(
      preactNoRenderArguments,
      `
      const render = (props) => <h1>{props.name}</h1>;
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `static render(input)` utility on a Component subclass", () => {
    const result = runRule(
      preactNoRenderArguments,
      `
      import { Component } from "preact";

      class Renderer extends Component {
        static render(input) {
          return input;
        }

        render() {
          return <span>{this.props.label}</span>;
        }
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `this:` typed-only parameter when the runtime arg list is empty", () => {
    const result = runRule(
      preactNoRenderArguments,
      `
      import { Component } from "preact";

      class Hello extends Component<{ name: string }> {
        render(this: Hello) {
          return <h1>{this.props.name}</h1>;
        }
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags the user-declared parameter even when a `this:` type annotation is present", () => {
    const result = runRule(
      preactNoRenderArguments,
      `
      import { Component } from "preact";

      class Hello extends Component<{ name: string }> {
        render(this: Hello, props: { name: string }) {
          return <h1>{props.name}</h1>;
        }
      }
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`render(props, state)`");
  });
});
