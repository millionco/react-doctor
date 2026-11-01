import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isClosedJsonSnapshotClassCarrier } from "./is-closed-json-snapshot-class-carrier.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

const CLASS_IMPORT = `import React from "react";`;
const CLASS_BOUNDARY = `class Carrier extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error) { return { hasError: true }; }
  componentDidCatch(error, info) { console.error("Failed", error, info.componentStack); }
  render() { if (this.state.hasError) return <h1>Unavailable</h1>; return this.props.children; }
}`;

const inspectCarrier = (sourceText: string): boolean => {
  const program = parseSourceText({ filename: "carrier.jsx", sourceText });
  expect(program).not.toBeNull();
  if (!program) throw new Error("Fixture must parse");
  let classNode: EsTreeNode | null = null;
  walkAst(program, (node) => {
    if (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression"))
      classNode = node;
  });
  if (!classNode) throw new Error("Fixture must contain class");
  return isClosedJsonSnapshotClassCarrier({
    classNode,
    module: {
      filePath: "carrier.jsx",
      sourceText,
      program,
      scopes: analyzeScopes(program),
    },
  });
};

describe("isClosedJsonSnapshotClassCarrier", () => {
  it("accepts an ordinary unchanged children carrier", () => {
    expect(
      inspectCarrier(
        `${CLASS_IMPORT} class Carrier extends React.Component { render() { return this.props.children; } }`,
      ),
    ).toBe(true);
  });

  it("accepts a complete monotone error boundary", () => {
    expect(inspectCarrier(`${CLASS_IMPORT} ${CLASS_BOUNDARY}`)).toBe(true);
  });

  it("accepts a genuine named Component alias", () => {
    expect(
      inspectCarrier(
        `import { Component as Base } from "react"; ${CLASS_BOUNDARY.replace("React.Component", "Base")}`,
      ),
    ).toBe(true);
  });

  it("accepts a class state field and conditional fallback", () => {
    const source = CLASS_BOUNDARY.replace(
      "constructor(props) { super(props); this.state = { hasError: false }; }",
      "state = { hasError: false };",
    ).replace(
      "if (this.state.hasError) return <h1>Unavailable</h1>; return this.props.children;",
      "return this.state.hasError ? <h1>Unavailable</h1> : this.props.children;",
    );
    expect(inspectCarrier(`${CLASS_IMPORT} ${source}`)).toBe(true);
  });

  it.each([
    ["custom base", "extends React.Component", "extends External"],
    ["PureComponent", "extends React.Component", "extends React.PureComponent"],
    ["wrong initial state", "hasError: false", "hasError: true"],
    ["error-state retry", "return { hasError: true }", "return { hasError: false }"],
    ["snapshot prop read", "return this.props.children", "return this.props.paragraphs"],
    [
      "children cloning",
      "return this.props.children",
      "return React.cloneElement(this.props.children)",
    ],
    ["children injection", "return this.props.children", "return <div>{this.props.children}</div>"],
    ["render callback", "return this.props.children", "return this.props.children()"],
    ["instance escape", 'console.error("Failed", error, info.componentStack)', "publish(this)"],
    [
      "reset on catch",
      'console.error("Failed", error, info.componentStack)',
      "this.setState({ hasError: false })",
    ],
    ["constructor props escape", "super(props);", "super(props); publish(props);"],
    ["constructor instance escape", "super(props);", "super(props); publish(this);"],
    [
      "fallback retry handler",
      "<h1>Unavailable</h1>",
      "<button onClick={() => this.setState({ hasError: false })}>Retry</button>",
    ],
    ["fallback props read", "<h1>Unavailable</h1>", "<h1>{this.props.message}</h1>"],
    [
      "unknown static hook",
      "static getDerivedStateFromError(error)",
      "static getDerivedStateFromProps(error)",
    ],
    [
      "derived error escape",
      "return { hasError: true }",
      "publish(error); return { hasError: true }",
    ],
    ["extra lifecycle", "render()", "componentDidMount() { publish(this); } render()"],
    ["static execution", "render()", "static { publish(this); } render()"],
    ["computed method", "render()", '["render"]()'],
    ["render getter", "render()", "get render()"],
    ["extra state field", "hasError: false", "hasError: false, attempts: 0"],
  ])("declines %s", (_label, before, after) => {
    expect(inspectCarrier(`${CLASS_IMPORT} ${CLASS_BOUNDARY.replace(before, after)}`)).toBe(false);
  });

  it("declines a shadowed Component import", () => {
    expect(
      inspectCarrier(
        `import { Component } from "react"; function create(Component) { return class Carrier extends Component { render() { return this.props.children; } }; }`,
      ),
    ).toBe(false);
  });

  it("declines a shadowed console logger", () => {
    expect(inspectCarrier(`${CLASS_IMPORT} const console = logger; ${CLASS_BOUNDARY}`)).toBe(false);
  });
});
