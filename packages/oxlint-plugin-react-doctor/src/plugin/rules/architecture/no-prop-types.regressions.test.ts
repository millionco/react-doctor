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

  it("reports transparent TypeScript wrappers and static computed property names", () => {
    expectDiagnosticCount(
      `const Panel = (((props: { value: string }) => <div>{props.value}</div>) satisfies React.FC<{ value: string }>);
       (Panel as typeof Panel)["propTypes"] = { value: () => true };
       import ReactDefault from "react";
       const Dialog = (class extends ReactDefault.Component {}) as typeof ReactDefault.Component;
       (Dialog!)["propTypes"] = { value: () => true };`,
      2,
    );
  });

  it("reports stable aliases of React component base classes", () => {
    expectDiagnosticCount(
      `import ReactDefault from "react";
       const ReactAlias = ReactDefault;
       const ComponentBase = ReactAlias["Component"];
       const ComponentAlias = ComponentBase;
       class Panel extends ComponentAlias { static ["propTypes"] = { value: () => true }; }`,
      1,
    );
  });

  it("keeps mutable, imported, and unrelated class aliases quiet", () => {
    expectDiagnosticCount(
      `import ImportedPanel from "./panel";
       ImportedPanel.propTypes = { value: () => true };
       const LocalPanel = () => <div />;
       let MutablePanel = LocalPanel;
       MutablePanel.propTypes = { value: () => true };
       const React = { Component: class {} };
       const ComponentBase = React.Component;
       class Protocol extends ComponentBase { static propTypes = { value: () => true }; }`,
      0,
    );
  });

  it("reports components wrapped by proven React memo and forwardRef bindings", () => {
    expectDiagnosticCount(
      `import ReactDefault, { forwardRef as withRef, memo as withMemo } from "react";
       const ReactAlias = ReactDefault;
       const Panel = withMemo(withRef((props: { value: string }, ref) => <div ref={ref}>{props.value}</div>));
       Panel.propTypes = { value: () => true };
       const DialogRender = (props: { value: string }) => <div>{props.value}</div>;
       const Dialog = ReactAlias.memo(DialogRender);
       Dialog.propTypes = { value: () => true };
       function renderSheet(props: { value: string }) { return <div>{props.value}</div>; }
       const Sheet = withMemo(renderSheet);
       Sheet.propTypes = { value: () => true };`,
      3,
    );
  });

  it("keeps same-named userland wrappers and non-rendering React callbacks quiet", () => {
    expectDiagnosticCount(
      `import { memo as reactMemo } from "react";
       const memo = (callback: () => unknown) => callback;
       const forwardRef = memo;
       const Schema = memo(forwardRef(() => ({ value: true })));
       Schema.propTypes = { value: () => true };
       const Protocol = reactMemo(() => ({ value: true }));
       Protocol.propTypes = { value: () => true };`,
      0,
    );
  });

  it("reports an exact component function returned by proven React useMemo", () => {
    expectDiagnosticCount(
      `import { useMemo as useStableValue } from "react";
       const Outer = () => {
         const Panel = useStableValue(() => ({ value }: { value: string }) => <div>{value}</div>, []);
         Panel.propTypes = { value: () => true };
         return <Panel value="ok" />;
       };`,
      1,
    );
  });

  it("keeps shadowed useMemo and non-component memoized values quiet", () => {
    expectDiagnosticCount(
      `const useMemo = (callback: () => unknown) => callback();
       const Schema = useMemo(() => () => ({ value: true }), []);
       Schema.propTypes = { value: () => true };
       import { useMemo as useStableValue } from "react";
       const Protocol = useStableValue(() => ({ value: true }), []);
       Protocol.propTypes = { value: () => true };
       const Ambiguous = useStableValue(() => Math.random() > 0.5 ? (() => <div />) : { value: true }, []);
       Ambiguous.propTypes = { value: () => true };`,
      0,
    );
  });
});
