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

  it("reports components that build JSX into a let binding before returning it", () => {
    expectDiagnosticCount(
      `export function Panel(props: { value: string }) {
         let content;
         if (props.value) {
           content = <div>{props.value}</div>;
         } else {
           content = <span />;
         }
         return content;
       }
       Panel.propTypes = { value: () => true };`,
      1,
    );
  });

  it("ignores utilities whose let-bound JSX is never returned", () => {
    expectDiagnosticCount(
      `export function BuildLabel(register: (node: unknown) => void) {
         let preview = <div>preview</div>;
         register(preview);
         return "label";
       }
       BuildLabel.propTypes = { value: () => true };`,
      0,
    );
  });

  it("ignores unreachable and overwritten JSX writes to returned utility values", () => {
    expectDiagnosticCount(
      `export function BuildLabel() {
         let output = "label";
         function unused() { output = <div />; }
         return output;
         output = <span />;
       }
       BuildLabel.propTypes = { value: () => true };
       export function BuildTitle() {
         let output = <strong>preview</strong>;
         output = "title";
         return output;
       }
       BuildTitle.propTypes = { value: () => true };`,
      0,
    );
  });

  it("ignores JSX writes on paths that exit before the returned binding", () => {
    expectDiagnosticCount(
      `export function BuildLabel(condition: boolean) {
         let output;
         if (condition) {
           output = <div />;
           return "label";
         }
         return output;
       }
       BuildLabel.propTypes = { value: () => true };`,
      0,
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

  it("keeps imported and unrelated class aliases quiet", () => {
    expectDiagnosticCount(
      `import ImportedPanel from "./panel";
       ImportedPanel.propTypes = { value: () => true };
       const React = { Component: class {} };
       const ComponentBase = React.Component;
       class Protocol extends ComponentBase { static propTypes = { value: () => true }; }`,
      0,
    );
  });

  it("keeps reassigned function and class component bindings quiet", () => {
    expectDiagnosticCount(
      `import ReactDefault from "react";
       let Panel = (props: { value: string }) => <div>{props.value}</div>;
       Panel = { propTypes: {} };
       Panel.propTypes = { value: () => true };
       function Dialog() { return <div />; }
       Dialog = Object.assign(() => null, { propTypes: {} });
       Dialog.propTypes = { value: () => true };
       class Sheet extends ReactDefault.Component {}
       Sheet = class {};
       Sheet.propTypes = { value: () => true };
       let Modal = class extends ReactDefault.Component {};
       Modal = class {};
       Modal.propTypes = { value: () => true };`,
      0,
    );
  });

  it("reports components whose nested binding writes cannot run before propTypes", () => {
    expectDiagnosticCount(
      `function Panel() { return <div />; }
       function neverCalled() { Panel = () => null; }
       Panel.propTypes = { value: () => true };
       let Dialog = () => <div />;
       const mutateDialog = () => { Dialog = () => null; };
       Dialog.propTypes = { value: () => true };
       mutateDialog();
       let Sheet = () => <div />;
       const mutateSheet = () => { Sheet = () => null; };
       setTimeout(mutateSheet, 0);
       Sheet.propTypes = { value: () => true };`,
      3,
    );
  });

  it("keeps components quiet when nested binding writes run before propTypes", () => {
    expectDiagnosticCount(
      `function Panel() { return <div />; }
       function mutatePanel() { Panel = () => null; }
       if (shouldMutate) mutatePanel();
       Panel.propTypes = { value: () => true };
       let Dialog = () => <div />;
       const mutateDialog = async () => { Dialog = () => null; };
       const mutateDialogAlias = mutateDialog;
       void mutateDialogAlias();
       Dialog.propTypes = { value: () => true };
       let Sheet = () => <div />;
       (() => { Sheet = () => null; })();
       Sheet.propTypes = { value: () => true };`,
      0,
    );
  });

  it("preserves component values captured before a later reassignment", () => {
    expectDiagnosticCount(
      `function Panel() { return <div />; }
       Panel.propTypes = { value: () => true };
       Panel = Object.assign(() => null, { propTypes: {} });
       function Dialog() { return <div />; }
       const DialogAlias = Dialog;
       Dialog = Object.assign(() => null, { propTypes: {} });
       DialogAlias.propTypes = { value: () => true };
       const Sheet = () => <div />;
       let MutableSheet = Sheet;
       MutableSheet.propTypes = { value: () => true };
       MutableSheet = Object.assign(() => null, { propTypes: {} });`,
      3,
    );
  });

  it("keeps aliases captured after component reassignment quiet", () => {
    expectDiagnosticCount(
      `function Panel() { return <div />; }
       Panel = Object.assign(() => null, { propTypes: {} });
       const PanelAlias = Panel;
       PanelAlias.propTypes = { value: () => true };`,
      0,
    );
  });

  it("tracks class base aliases at their capture point", () => {
    expectDiagnosticCount(
      `import ReactDefault from "react";
       class StableBase extends ReactDefault.Component {}
       const StableAlias = StableBase;
       StableBase = class {};
       class Dialog extends StableAlias { static propTypes = { value: () => true }; }
       class ReassignedBase extends ReactDefault.Component {}
       ReassignedBase = class {};
       const ReassignedAlias = ReassignedBase;
       class Protocol extends ReassignedAlias { static propTypes = { value: () => true }; }`,
      1,
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

  it("reports hook-owning components that render null or children", () => {
    expectDiagnosticCount(
      `import { useContext as useReactContext, useEffect as useReactEffect } from "react";
       const Panel = ({ children }: { children: React.ReactNode }) => {
         const visible = useReactContext(VisibilityContext);
         return visible ? children : null;
       };
       Panel.propTypes = { children: () => true };
       function Dialog() {
         useReactEffect(() => {}, []);
         return null;
       }
       Dialog.propTypes = { value: () => true };`,
      2,
    );
  });

  it("keeps same-named userland hooks and nested hook calls quiet", () => {
    expectDiagnosticCount(
      `import { useContext } from "./context";
       import { useEffect as useReactEffect } from "react";
       const Schema = () => { useContext(); return null; };
       Schema.propTypes = { value: () => true };
       const Protocol = () => {
         const nested = () => { useReactEffect(() => {}, []); };
         return null;
       };
       Protocol.propTypes = { value: () => true };`,
      0,
    );
  });

  it("tracks component identity across property mutation but not object copies", () => {
    expectDiagnosticCount(
      `const Panel = () => <div />;
       Panel.metadata = { stable: true };
       const PanelAlias = Panel;
       PanelAlias.displayName = "Panel";
       PanelAlias.propTypes = { value: () => true };
       const Schema = { ...PanelAlias };
       Schema.propTypes = { value: () => true };`,
      1,
    );
  });

  it("reports binding-proven styled-components and props-children components", () => {
    expectDiagnosticCount(
      `import styledDefault from "styled-components";
       const styledAlias = styledDefault;
       const Panel = styledAlias.div.attrs(({ theme, ...rest }) => ({ theme, ...rest }))\`color: red;\`;
       Panel.propTypes = { value: () => true };
       const Tab = ({ children, title }) => title && children;
       Tab.propTypes = { children: () => true };
       const Sheet = (props: { children: React.ReactNode }) => props.children;
       Sheet.propTypes = { children: () => true };`,
      3,
    );
  });

  it("keeps same-named userland styled factories and children helpers quiet", () => {
    expectDiagnosticCount(
      `const styled = { div: { attrs: () => (parts: TemplateStringsArray) => ({ parts }) } };
       const Schema = styled.div.attrs(() => ({}))\`value\`;
       Schema.propTypes = { value: () => true };
       const ChildrenMap = ({ children }: { children: unknown }) => ({ children });
       ChildrenMap.propTypes = { children: () => true };
       import { css } from "styled-components";
       const Protocol = css.div\`value\`;
       Protocol.propTypes = { value: () => true };`,
      0,
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
       Ambiguous.propTypes = { value: () => true };
       const Branched = useStableValue(() => {
         if (Math.random() > 0.5) return { value: true };
         return () => <div />;
       }, []);
       Branched.propTypes = { value: () => true };
       const EarlyExit = useStableValue(() => {
         if (Math.random() > 0.5) return;
         return () => <div />;
       }, []);
       EarlyExit.propTypes = { value: () => true };`,
      0,
    );
  });

  it("ignores hook-owning object helpers and JSX in discarded callbacks", () => {
    expectDiagnosticCount(
      `import { useMemo } from "react";
       const Schema = (items: string[]) => {
         const count = useMemo(() => items.length, [items]);
         items.map((item) => <div>{item}</div>);
         return { count };
       };
       Schema.propTypes = { value: () => true };`,
      0,
    );
  });

  it("only treats children from the props parameter as render output", () => {
    expectDiagnosticCount(
      `const Schema = (value: string, options: { children: unknown }) => options.children;
       Schema.propTypes = { value: () => true };
       const Protocol = (value: string, children: unknown) => children;
       Protocol.propTypes = { value: () => true };
       const Panel = (props: { children: React.ReactNode }, options: unknown) => props.children;
       Panel.propTypes = { children: () => true };`,
      1,
    );
  });

  it("ignores component factories whose relevant properties were replaced", () => {
    expectDiagnosticCount(
      `import ReactDefault from "react";
       import styledDefault from "styled-components";
       const ReactAlias = ReactDefault;
       ReactAlias.Component = class {};
       class Schema extends ReactAlias.Component { static propTypes = { value: () => true }; }
       ReactAlias.memo = (value: unknown) => value;
       const Protocol = ReactAlias.memo(() => <div />);
       Protocol.propTypes = { value: () => true };
       const styledAlias = styledDefault;
       styledAlias.div = (parts: TemplateStringsArray) => ({ parts });
       const RecordShape = styledAlias.div\`color: red;\`;
       RecordShape.propTypes = { value: () => true };`,
      0,
    );
  });

  it("tracks relevant property replacement through sibling aliases and const keys", () => {
    expectDiagnosticCount(
      `import ReactDefault from "react";
       import styledDefault from "styled-components";
       const ReactAlias = ReactDefault;
       const ReactMutator = ReactAlias;
       const componentKey = "Component";
       ReactMutator[componentKey] = class {};
       class Schema extends ReactAlias.Component { static propTypes = { value: () => true }; }
       const memoKey = "memo";
       ReactMutator[memoKey] = (value: unknown) => value;
       const Protocol = ReactAlias.memo(() => <div />);
       Protocol.propTypes = { value: () => true };
       const styledAlias = styledDefault;
       const styledMutator = styledAlias;
       const tagKey = "div";
       styledMutator[tagKey] = (parts: TemplateStringsArray) => ({ parts });
       const RecordShape = styledAlias.div\`color: red;\`;
       RecordShape.propTypes = { value: () => true };`,
      0,
    );
  });

  it("preserves components captured before sibling alias property replacement", () => {
    expectDiagnosticCount(
      `import ReactDefault from "react";
       const ReactAlias = ReactDefault;
       const ReactMutator = ReactAlias;
       class Panel extends ReactAlias.Component { static propTypes = { value: () => true }; }
       ReactMutator.Component = class {};`,
      1,
    );
    expectDiagnosticCount(
      `import ReactDefault from "react";
       const ReactAlias = ReactDefault;
       const ReactMutator = ReactAlias;
       const Dialog = ReactAlias.memo(() => <div />);
       ReactMutator.memo = (value: unknown) => value;
       Dialog.propTypes = { value: () => true };`,
      1,
    );
    expectDiagnosticCount(
      `import styledDefault from "styled-components";
       const styledAlias = styledDefault;
       const styledMutator = styledAlias;
       const Sheet = styledAlias.div\`color: red;\`;
       styledMutator.div = (parts: TemplateStringsArray) => ({ parts });
       Sheet.propTypes = { value: () => true };`,
      1,
    );
  });

  it("reports renamed and defaulted children destructuring", () => {
    expectDiagnosticCount(
      `const Panel = ({ children: content }: { children: React.ReactNode }) => content;
       Panel.propTypes = { children: () => true };
       const Dialog = ({ children: content = null }: { children?: React.ReactNode }) => content;
       Dialog.propTypes = { children: () => true };
       const Schema = ({ label: content }: { label: unknown }) => content;
       Schema.propTypes = { label: () => true };`,
      2,
    );
  });

  it("ignores positional names and nested children destructuring", () => {
    expectDiagnosticCount(
      `const Children = (children: unknown) => children;
       Children.propTypes = { children: () => true };
       const Schema = ({ children: { value } }: { children: { value: unknown } }) => value;
       Schema.propTypes = { value: () => true };
       const RecordShape = ({ children: [value] }: { children: unknown[] }) => value;
       RecordShape.propTypes = { value: () => true };`,
      0,
    );
  });

  it("ignores children evidence replaced before the returned value is read", () => {
    expectDiagnosticCount(
      `const ReassignedChild = ({ children }: { children: unknown }) => {
         children = { value: true };
         return children;
       };
       ReassignedChild.propTypes = { children: () => true };
       const ReassignedProps = (props: { children: unknown }) => {
         props = { children: { value: true } };
         return props.children;
       };
       ReassignedProps.propTypes = { children: () => true };
       const MutatedProps = (props: { children: unknown }) => {
         props.children = { value: true };
         return props.children;
       };
       MutatedProps.propTypes = { children: () => true };`,
      0,
    );
  });

  it("keeps stable children evidence when unrelated props change", () => {
    expectDiagnosticCount(
      `const Panel = (props: { children: React.ReactNode; title: string }) => {
         props.title = "updated";
         return props.children;
       };
       Panel.propTypes = { children: () => true };`,
      1,
    );
  });

  it("ignores callback JSX from non-render-preserving returned APIs", () => {
    expectDiagnosticCount(
      `const SomeSchema = (items: string[]) => items.some((item) => <span>{item}</span>);
       SomeSchema.propTypes = { value: () => true };
       const FindSchema = (items: string[]) => items.find((item) => <span>{item}</span>);
       FindSchema.propTypes = { value: () => true };
       const EachSchema = (items: string[]) => items.forEach((item) => <span>{item}</span>);
       EachSchema.propTypes = { value: () => true };
       const AsyncSchema = () => Promise.resolve("value").then((item) => <span>{item}</span>);
       AsyncSchema.propTypes = { value: () => true };
       const Panel = (items: string[]) => items.map((item) => <span>{item}</span>);
       Panel.propTypes = { value: () => true };`,
      1,
    );
  });

  it("ignores uncalled and deferred nested factory mutations", () => {
    expectDiagnosticCount(
      `import ReactDefault from "react";
       import styledDefault from "styled-components";
       const ReactAlias = ReactDefault;
       const mutateReact = () => {
         ReactAlias.Component = class {};
         ReactAlias.memo = (value: unknown) => value;
       };
       const Schema = ReactAlias.memo(() => <div />);
       Schema.propTypes = { value: () => true };
       class Protocol extends ReactAlias.Component { static propTypes = { value: () => true }; }
       setTimeout(mutateReact, 0);
       const mutateStyled = () => { styledDefault.div = (parts: TemplateStringsArray) => ({ parts }); };
       queueMicrotask(mutateStyled);
       const RecordShape = styledDefault.div\`color: red;\`;
       RecordShape.propTypes = { value: () => true };`,
      3,
    );
  });

  it("tracks nested factory mutations only when invoked before capture", () => {
    expectDiagnosticCount(
      `import ReactDefault from "react";
       import styledDefault from "styled-components";
       const mutateReact = () => {
         ReactDefault.Component = class {};
         ReactDefault.memo = (value: unknown) => value;
       };
       mutateReact();
       const Schema = ReactDefault.memo(() => <div />);
       Schema.propTypes = { value: () => true };
       class Protocol extends ReactDefault.Component { static propTypes = { value: () => true }; }
       const mutateStyled = () => { styledDefault.div = (parts: TemplateStringsArray) => ({ parts }); };
       mutateStyled();
       const RecordShape = styledDefault.div\`color: red;\`;
       RecordShape.propTypes = { value: () => true };`,
      0,
    );
    expectDiagnosticCount(
      `import ReactDefault from "react";
       import styledDefault from "styled-components";
       const mutateReact = () => {
         ReactDefault.Component = class {};
         ReactDefault.memo = (value: unknown) => value;
       };
       const Panel = ReactDefault.memo(() => <div />);
       Panel.propTypes = { value: () => true };
       class Dialog extends ReactDefault.Component { static propTypes = { value: () => true }; }
       mutateReact();
       const mutateStyled = () => { styledDefault.div = (parts: TemplateStringsArray) => ({ parts }); };
       const Sheet = styledDefault.div\`color: red;\`;
       Sheet.propTypes = { value: () => true };
       mutateStyled();`,
      3,
    );
  });
});
