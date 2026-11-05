import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

const EXAMPLE = `
  import { Component as ReactComponent } from "react";
  export class Results extends ReactComponent {
    constructor(props) {
      super(props);
      this.state = { isLoading: true, entries: null };
    }

    componentDidMount() {
      ;(async () => {
        try {
          const response = await fetch("/api/results");
          const entries = await response.json();
          this.setState({ entries, isLoading: false });
        } catch (error) {
          console.log(error);
        }
      })();
    }

    render() {
      return this.state.isLoading ? <p>Loading</p> : <p>{this.state.entries}</p>;
    }
  }
`;

const analyze = (source: string) =>
  runRule(noLoadingFlagResetOutsideFinally, source, { filename: "Results.jsx" });

describe("no-loading-flag-reset-outside-finally — class mount tasks", () => {
  it("reports when a failed mount fetch leaves the initially loading view stuck", () => {
    const result = analyze(EXAMPLE);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("only on the success path");
  });

  it("also reports a React namespace base and an empty catch", () => {
    const source = EXAMPLE.replace("{ Component as ReactComponent }", "* as React")
      .replace("extends ReactComponent", "extends React.Component")
      .replace("console.log(error);", "");
    const result = analyze(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("declines runtime replacement of the constructor invoked by super", () => {
    const result = analyze(`${EXAMPLE}
      Reflect.setPrototypeOf(Results, class extends ReactComponent {
        constructor(props) {
          super(props);
          queueMicrotask(() => { this.state.isLoading = false; });
        }
      });
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines a class alias or reflected provider route before mounting", () => {
    const result = analyze(`${EXAMPLE}
      const { getPrototypeOf: getBase, setPrototypeOf: replaceBase } = Object;
      const candidate = Results;
      replaceBase(candidate, getBase(candidate));
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines an alternate React provider obtained with createRequire", () => {
    const result = analyze(`
      import { createRequire as getLoader } from "node:module";
      const load = getLoader(import.meta.url);
      const base = load("react").Component;
      const inherited = Reflect.get(base, "prototype");
      Object.defineProperty(inherited, "state", {
        set(value) {
          value.isLoading = false;
          Object.defineProperty(this, "state", { value, writable: true, configurable: true });
        },
      });
      ${EXAMPLE}
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'import provider = require("react"); consume(provider);',
    'void import("react").then(consume);',
    'const provider = Reflect.get(window, "React");',
  ])("declines visible alternate runtime access: %s", (preamble) => {
    const result = runRule(noLoadingFlagResetOutsideFinally, preamble + EXAMPLE, {
      filename: "Results.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("permits JSX-only static imports and unrelated reflection", () => {
    const source = `
      import { Listing } from "example-ui";
      const heading = Reflect.get(metadata, "title");
      ${EXAMPLE.replace("<p>Loading</p>", "<Listing title={heading} />")}
    `;
    const result = analyze(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["catch reset", "console.log(error);", "this.setState({ isLoading: false });"],
    [
      "finally reset",
      "console.log(error);\n        }",
      "console.log(error); } finally { this.setState({ isLoading: false }); }",
    ],
    ["different flag", "entries, isLoading: false", "entries, isUpdating: false"],
    ["initially cleared flag", "isLoading: true", "isLoading: false"],
    [
      "later state replacement",
      "this.state = { isLoading: true, entries: null };",
      "this.state = { isLoading: true, entries: null }; this.state.isLoading = false;",
    ],
    ["own setState override", "    render() {", "    setState(update) {}\n    render() {"],
    ["own state field", "    render() {", "    state = { isLoading: false };\n    render() {"],
    ["foreign component base", 'from "react";', 'from "foreign-react";'],
    [
      "native fetch replaced",
      "  export class Results",
      "  globalThis.fetch = fakeFetch;\n  export class Results",
    ],
    [
      "shadowed fetch",
      "  export class Results",
      "  const fetch = loadFixture;\n  export class Results",
    ],
    [
      "visible setter replacement",
      "  export class Results",
      "  ReactComponent.prototype.setState = replacement;\n  export class Results",
    ],
    ["conditional invocation", ";(async () => {", "if (enabled) (async () => {"],
    ["escaped callback", ";(async () => {", "launch(async () => {"],
    [
      "a logging helper that could clear state",
      "console.log(error);",
      "recordFailure(this, error);",
    ],
    ["a different Response receiver", "await response.json()", "await other.json()"],
    ["a nonnetwork URL", '"/api/results"', '"data:application/json,{}"'],
    ["a mutable Response binding", "const response", "let response"],
    [
      "an overwritten reset payload",
      "entries, isLoading: false",
      "entries, isLoading: false, isLoading: true",
    ],
    ["render state escape", "<p>Loading</p>", "<p>{prepare(this.state)}</p>"],
    ["a state projection write", "<p>Loading</p>", "<p>{this.state.isLoading = false}</p>"],
  ])("keeps the unsupported or safe %s shape quiet", (_reason, before, after) => {
    expect(EXAMPLE).toContain(before);
    const original = _reason === "escaped callback" ? EXAMPLE.replace("})();", "});") : EXAMPLE;
    const result = analyze(original.replace(before, after));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
