import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDidUpdateSetState } from "./no-did-update-set-state.js";

const componentWithProducer = (
  producer: string,
  update = `const layout = this.getLayout();
    if (layout !== this.state.layout) this.setState({ layout });`,
  extra = "",
): string => `
  import * as React from "react";
  class Panel extends React.Component {
    state = { layout: "unset" };
    componentDidUpdate() { ${update} }
    ${producer}
    render() { return <div />; }
    ${extra}
  }
`;

describe("no-did-update-set-state closed primitive producers", () => {
  it.each([
    ["string", 'return "ready";'],
    ["boolean", "return true;"],
    ["null", "return null;"],
    ["undefined", "return undefined;"],
    ["numeric literal", "return 2;"],
    ["props-dependent enum", 'return this.props.enabled ? "ready" : "idle";'],
    ["boolean projection", "return !this.props.disabled;"],
    ["strict comparison", 'return this.props.mode === "ready";'],
    ["typeof projection", "return typeof this.props.layout;"],
    ["nested enum", 'return this.props.enabled ? this.props.compact ? "small" : "large" : null;'],
  ])("accepts a closed %s producer", (_description, body) => {
    const result = runRule(noDidUpdateSetState, componentWithProducer(`getLayout() { ${body} }`));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts an arrow field producer", () => {
    const result = runRule(
      noDidUpdateSetState,
      componentWithProducer('getLayout = () => this.props.enabled ? "ready" : "idle";'),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("follows direct readonly aliases without changing the payload proof", () => {
    const result = runRule(
      noDidUpdateSetState,
      componentWithProducer(
        'getLayout() { return "ready"; }',
        `const produced = this.getLayout();
         const layout = produced;
         if (layout !== this.state.layout) this.setState({ layout });`,
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["unknown prop", "return this.props.layout;"],
    ["state-dependent toggle", 'return this.state.layout === "left" ? "right" : "left";'],
    ["DOM measurement", "return this.panelRef.current.textContent;"],
    ["fresh object", "return {};"],
    ["regexp object", "return /ready/;"],
    ["fresh symbol", 'return Symbol("ready");'],
    ["random value", "return Math.random();"],
    ["global NaN", "return NaN;"],
    ["number NaN", "return Number.NaN;"],
    ["non-reflexive arithmetic", "return 0 / 0;"],
    ["unknown numeric coercion", "return +this.props.layout;"],
    ["logical return", 'return this.props.layout && "ready";'],
    ["captured value", "return captured;"],
    ["unknown call", "return readLayout();"],
  ])("retains the warning for a %s producer", (_description, body) => {
    const result = runRule(noDidUpdateSetState, componentWithProducer(`getLayout() { ${body} }`));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["callback", "this.setState({ layout }, () => performWork());"],
    ["different payload", 'this.setState({ layout: "other" });'],
    ["extra payload field", "this.setState({ layout, active: true });"],
    ["spread payload", "this.setState({ layout, ...payload });"],
  ])("retains the warning for a %s", (_description, setter) => {
    const result = runRule(
      noDidUpdateSetState,
      componentWithProducer(
        'getLayout() { return "ready"; }',
        `const layout = this.getLayout();
         if (layout !== this.state.layout) ${setter}`,
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["method replacement", 'this.getLayout = () => "other";'],
    ["instance alias", "const instance = this;"],
    ["method alias", "const read = this.getLayout;"],
    ["prop mutation", "this.props.enabled = !this.props.enabled;"],
    ["additional call", "performWork();"],
  ])("rejects a visible %s", (_description, prefix) => {
    const result = runRule(
      noDidUpdateSetState,
      componentWithProducer(
        'getLayout() { return "ready"; }',
        `${prefix}
         const layout = this.getLayout();
         if (layout !== this.state.layout) this.setState({ layout });`,
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["object default", "const { layout = NaN } = this.getLayout();"],
    ["array default", "const [layout = NaN] = this.getLayout();"],
    ["mutable alias", "let layout = this.getLayout(); layout = NaN;"],
  ])("does not treat a %s as the returned primitive", (_description, declaration) => {
    const result = runRule(
      noDidUpdateSetState,
      componentWithProducer(
        'getLayout() { return "ready"; }',
        `${declaration}
         if (layout !== this.state.layout) this.setState({ layout });`,
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["async method", 'async getLayout() { return "ready"; }'],
    ["generator method", '*getLayout() { return "ready"; }'],
    ["parameter", 'getLayout(flag = true) { return "ready"; }'],
    ["accessor", 'get getLayout() { return () => "ready"; }'],
    ["multiple statements", 'getLayout() { const value = "ready"; return value; }'],
    ["static duplicate", 'getLayout() { return "ready"; } static getLayout() { return "other"; }'],
  ])("rejects an unsupported %s", (_description, producer) => {
    const result = runRule(noDidUpdateSetState, componentWithProducer(producer));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a class binding escape", () => {
    const code = `${componentWithProducer('getLayout() { return "ready"; }')}
      const Other = Panel;`;
    const result = runRule(noDidUpdateSetState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["auto-accessor", 'accessor marker = "ready";'],
    ["duplicate auto-accessor", "accessor getLayout = () => ({});"],
    ["static block", "static {}"],
    ["decorated member", '@decorate marker = "ready";'],
    ["decorated auto-accessor", '@decorate accessor marker = "ready";'],
    ["computed member", "[memberName]() {}"],
  ])("rejects an unsupported %s", (_description, extra) => {
    const result = runRule(
      noDidUpdateSetState,
      componentWithProducer('getLayout() { return "ready"; }', undefined, extra),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a class decorator", () => {
    const code = componentWithProducer('getLayout() { return "ready"; }').replace(
      "class Panel",
      "@decorate class Panel",
    );
    const result = runRule(noDidUpdateSetState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["direct JSX", "return <Child value={this.state} />;"],
    ["aliased JSX", "const snapshot = this.state; return <Child value={snapshot} />;"],
    ["spread JSX", "return <Child {...this.state} />;"],
  ])("rejects a raw state escape through %s", (_description, render) => {
    const code = `import Child from "external-view";
      ${componentWithProducer('getLayout() { return "ready"; }').replace(
        "return <div />;",
        render,
      )}`;
    const result = runRule(noDidUpdateSetState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves a direct state-field render read", () => {
    const code = componentWithProducer('getLayout() { return "ready"; }').replace(
      "return <div />;",
      "return <span>{this.state.layout}</span>;",
    );
    const result = runRule(noDidUpdateSetState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["prop setter field", "setState = this.props.update;"],
    ["imported setter field", "setState = update;"],
    ["setter method", "setState(next) {}"],
    ["setter arrow field", "setState = (next) => {};"],
    ["setter accessor", "get setState() { return this.props.update; }"],
    ["prop updater field", "updater = this.props.updater;"],
    ["imported updater field", "updater = updater;"],
    ["updater accessor", "get updater() { return this.props.updater; }"],
  ])("rejects an own React updater override: %s", (_description, extra) => {
    const code = `import update, { updater } from "external-updater";
      ${componentWithProducer('getLayout() { return "ready"; }', undefined, extra)}`;
    const result = runRule(noDidUpdateSetState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects an escaped setter method", () => {
    const result = runRule(
      noDidUpdateSetState,
      componentWithProducer(
        'getLayout() { return "ready"; }',
        `const update = this.setState;
         const layout = this.getLayout();
         if (layout !== this.state.layout) this.setState({ layout });`,
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects an escaped React updater provider", () => {
    const code = `import Child from "external-view";
      ${componentWithProducer('getLayout() { return "ready"; }').replace(
        "return <div />;",
        "return <Child value={this.updater} />;",
      )}`;
    const result = runRule(noDidUpdateSetState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
