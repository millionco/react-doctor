import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLegacyClassLifecycles } from "./no-legacy-class-lifecycles.js";

const run = (code: string) =>
  runRule(noLegacyClassLifecycles, code, { filename: "src/components/Board.tsx" });

describe("architecture/no-legacy-class-lifecycles — regressions", () => {
  // prod-fp audit: the rule matched purely on member NAME, so a plain class
  // with no `extends` — which can never be a React component — false-fired.
  it("does not flag a class with no superclass", () => {
    const result = run(
      `class LifecycleShim {
  componentWillMount() {}
  componentWillReceiveProps(next) {}
  componentWillUpdate() {}
}`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a superclass-less class expression", () => {
    const result = run(
      `const adapter = class {
  UNSAFE_componentWillMount() {}
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a static member with a lifecycle name", () => {
    const result = run(
      `import { Component } from "react";
class Board extends Component {
  static componentWillReceiveProps() {}
  render() { return null; }
}`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a computed key referencing a variable named like a lifecycle", () => {
    const result = run(
      `import { Component } from "react";
const componentWillMount = Symbol("hook");
class Board extends Component {
  [componentWillMount]() {}
  render() { return null; }
}`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags componentWillMount on a Component subclass", () => {
    const result = run(
      `import { Component } from "react";
class Board extends Component {
  componentWillMount() {}
  render() { return null; }
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("componentWillMount");
  });

  it("still flags the UNSAFE_ prefixed form", () => {
    const result = run(
      `import React from "react";
class Board extends React.Component {
  UNSAFE_componentWillReceiveProps(next) {}
  render() { return null; }
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("UNSAFE_componentWillReceiveProps");
  });

  it("still flags a class-property lifecycle on a PureComponent subclass", () => {
    const result = run(
      `import { PureComponent } from "react";
class Board extends PureComponent {
  componentWillUpdate = () => {};
  render() { return null; }
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // Legacy codebases routinely extend their own base classes, so ANY
  // superclass keeps the rule live — only `extends`-less classes are skipped.
  it("still flags lifecycles on a custom base-class subclass", () => {
    const result = run(
      `import { BaseContainer } from "./base-container";
class Board extends BaseContainer {
  componentWillReceiveProps(next) {}
  render() { return null; }
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps reporting each legacy lifecycle in a class separately", () => {
    const result = run(
      `import { Component } from "react";
class Board extends Component {
  componentWillMount() {}
  componentWillReceiveProps(next) {}
  componentWillUpdate() {}
  render() { return null; }
}`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });
});
