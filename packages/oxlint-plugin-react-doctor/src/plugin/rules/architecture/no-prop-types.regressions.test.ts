import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropTypes } from "./no-prop-types.js";

const expectDiagnosticCount = (code: string, expectedCount: number): void => {
  const result = runRule(noPropTypes, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedCount);
};

describe("architecture/no-prop-types component provenance", () => {
  it("ignores an uppercase validation object", () => {
    expectDiagnosticCount(
      `export const Schema = { propTypes: {} as Record<string, (value: unknown) => boolean> };
       Schema.propTypes = { value: (value: unknown): boolean => typeof value === "string" };`,
      0,
    );
  });

  it("reports propTypes assignments on local function components", () => {
    expectDiagnosticCount(
      `export const Panel = (props: { value: string }) => <div>{props.value}</div>;
       Panel.propTypes = { value: (value: unknown): boolean => typeof value === "string" };
       export function Dialog(props: { value: string }) { return <div>{props.value}</div>; }
       Dialog.propTypes = { value: (value: unknown): boolean => typeof value === "string" };`,
      2,
    );
  });

  it("reports immutable aliases of local function components", () => {
    expectDiagnosticCount(
      `const Panel = (props: { value: string }) => <div>{props.value}</div>;
       const PanelAlias = Panel;
       PanelAlias.propTypes = { value: (value: unknown): boolean => typeof value === "string" };`,
      1,
    );
  });

  it("reports namespace-merged function components", () => {
    expectDiagnosticCount(
      `export function Panel(props: { value: string }) { return <div>{props.value}</div>; }
       export namespace Panel { export let propTypes: Record<string, () => boolean>; }
       Panel.propTypes = { value: () => true };`,
      1,
    );
  });

  it("ignores uppercase functions without React render output", () => {
    expectDiagnosticCount(
      `const Schema = (value: unknown): boolean => typeof value === "string";
       Schema.propTypes = { value: Schema };`,
      0,
    );
  });

  it("reports static propTypes only on proven React class components", () => {
    expectDiagnosticCount(
      `import ReactDefault, { Component as ReactComponent } from "react";
       class Panel extends ReactDefault.Component { static propTypes = { value: () => true }; }
       class DialogBase extends ReactComponent {}
       class Dialog extends DialogBase { static propTypes = { value: () => true }; }
       class Schema extends Map<string, unknown> { static propTypes = { value: () => true }; }
       class Protocol { static propTypes = { value: () => true }; }`,
      2,
    );
  });

  it("reports propTypes assignments on proven React class components", () => {
    expectDiagnosticCount(
      `import { PureComponent as ReactPureComponent } from "react";
       class Panel extends ReactPureComponent {}
       Panel.propTypes = { value: () => true };
       const Dialog = class extends ReactPureComponent {};
       Dialog.propTypes = { value: () => true };
       class Schema extends Map<string, unknown> {}
       Schema.propTypes = { value: () => true };`,
      2,
    );
  });

  it("ignores shadowed React class names", () => {
    expectDiagnosticCount(
      `const React = { Component: class {} };
       class Schema extends React.Component { static propTypes = { value: () => true }; }
       class Component {}
       class Protocol extends Component { static propTypes = { value: () => true }; }`,
      0,
    );
  });
});
