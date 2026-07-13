import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLegacyContextApi } from "./no-legacy-context-api.js";

describe("architecture/no-legacy-context-api — regressions", () => {
  it("flags a provider class using childContextTypes and getChildContext", () => {
    const result = runRule(
      noLegacyContextApi,
      `import React from "react";
class ColorProvider extends React.Component {
  static childContextTypes = { color: PropTypes.string };
  getChildContext() {
    return { color: "red" };
  }
  render() {
    return <div>{this.props.children}</div>;
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a top-level Component.contextTypes assignment", () => {
    const result = runRule(
      noLegacyContextApi,
      `const Button = (props, context) => <button>{context.color}</button>;
Button.contextTypes = { color: PropTypes.string };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("ignores unrelated classes and uppercase registries", () => {
    const result = runRule(
      noLegacyContextApi,
      `export class ProtocolRegistry {
  static contextTypes = new Set<string>(["json", "text"]);
  static childContextTypes = new Map();
  getChildContext() { return { protocol: "json" }; }
}
export const Registry: { contextTypes?: ReadonlySet<string> } = {};
Registry.contextTypes = new Set<string>(["json", "text"]);
class Schema extends Map<string, unknown> { static contextTypes = {}; }
class Component {}
class ShadowedWidget extends Component { static contextTypes = {}; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports only legacy-shaped members on proven React classes", () => {
    const result = runRule(
      noLegacyContextApi,
      `import ReactDefault, { Component as ReactComponent } from "react";
class Provider extends ReactDefault.Component {
  static childContextTypes = { theme: () => null };
  getChildContext() { return { theme: "dark" }; }
  static getChildContext = () => ({ theme: "ignored" });
}
class ConsumerBase extends ReactComponent {}
class Consumer extends ConsumerBase {
  static contextTypes = { theme: () => null };
  contextTypes = { applicationData: true };
}
class Modern extends ReactComponent { static contextType = ThemeContext; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports proven function, class, alias, and typed component assignments", () => {
    const result = runRule(
      noLegacyContextApi,
      `import ReactDefault, { type FunctionComponent as ReactFunctionComponent } from "react";
const Panel = () => <div />;
const PanelAlias = Panel;
PanelAlias.contextTypes = { theme: () => null };
class Dialog extends ReactDefault.Component {}
Dialog.contextTypes = { theme: () => null };
const Sheet: ReactFunctionComponent & { contextTypes?: object } = () => null;
Sheet.contextTypes = { theme: () => null };
const Modal: ReactDefault.FC & { contextTypes?: object } = () => null;
(Modal as typeof Modal).contextTypes = { theme: () => null };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(4);
  });

  it("follows React component type aliases and opaque component initializers", () => {
    const result = runRule(
      noLegacyContextApi,
      `import type { ComponentType as ReactView } from "react";
type LegacyView = (ReactView<{ theme: string }>) & { contextTypes?: object };
declare const loadView: () => ReactView<{ theme: string }>;
const LoadedView: LegacyView = loadView();
LoadedView.contextTypes = { theme: () => null };
const NullView: ReactView = null as unknown as ReactView;
NullView.childContextTypes = { theme: () => null };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports imported legacy component factory results and their aliases", () => {
    const result = runRule(
      noLegacyContextApi,
      `import createLegacyComponent from "create-react-class";
import React from "react";
const Provider = createLegacyComponent({ render() { return null; } });
const ProviderAlias = Provider;
ProviderAlias.childContextTypes = { theme: () => null };
const Consumer = React.createClass({ render() { return null; } });
Consumer.contextTypes = { theme: () => null };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps component-like names and shadowed component types conservative", () => {
    const result = runRule(
      noLegacyContextApi,
      `type FunctionComponent = () => null;
const Registry: FunctionComponent & { contextTypes?: object } = () => null;
Registry.contextTypes = {};
const Namespace = { FC: class {} };
const Schema: Namespace.FC & { contextTypes?: object } = {};
Schema.contextTypes = {};
function Formatter() { return "plain text"; }
Formatter.contextTypes = {};
const createLegacyComponent = () => ({ render: () => null });
const FactoryRegistry = createLegacyComponent();
FactoryRegistry.contextTypes = {};
type MaybeComponent = React.FC | (() => string);
const MaybeRegistry: MaybeComponent & { contextTypes?: object } = () => "plain";
MaybeRegistry.contextTypes = {};
let TypedPanel: React.FC & { contextTypes?: object } = () => null;
TypedPanel = () => null;
TypedPanel.contextTypes = {};
let Panel = () => <div />;
Panel = () => null;
Panel.contextTypes = {};
import ReactNamespace from "react";
ReactNamespace.Component = class {};
class FalseComponent extends ReactNamespace.Component {
  static contextTypes = {};
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps computed and renamed application members out of this detector", () => {
    const result = runRule(
      noLegacyContextApi,
      `import { Component } from "react";
class Panel extends Component {
  static ["contextTypes"] = {};
  static supportedContextTypes = {};
}
Panel["childContextTypes"] = {};
Panel.supportedContextTypes = {};
Panel.getChildContext = () => ({ theme: "dark" });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
