import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxHandlerNames } from "./jsx-handler-names.js";

interface ForwardedHandlerCase {
  name: string;
  code: string;
  expectedCount: number;
  settings?: Readonly<Record<string, unknown>>;
}

const cases: ForwardedHandlerCase[] = [
  {
    name: "exported arrow forwards its received event prop",
    code: "export const Action = (input) => <button onClick={input.onClick} />;",
    expectedCount: 0,
  },
  {
    name: "exported declaration forwards another event prop",
    code: "export function Dialog(input) { return <section onDismiss={input.onDismiss} />; }",
    expectedCount: 0,
  },
  {
    name: "default arrow forwards a prop",
    code: "export default (input) => <button onClick={input.onClick} />;",
    expectedCount: 0,
  },
  {
    name: "default declaration forwards a prop",
    code: "export default function Action(input) { return <button onClick={input.onClick} />; }",
    expectedCount: 0,
  },
  {
    name: "separate default export keeps component evidence",
    code: "const Action = (input) => <button onClick={input.onClick} />; export default Action;",
    expectedCount: 0,
  },
  {
    name: "separate named export keeps component evidence",
    code: "const Action = (input) => <button onClick={input.onClick} />; export { Action };",
    expectedCount: 0,
  },
  {
    name: "JSX usage proves a local component",
    code: "const Action = (input) => <button onClick={input.onClick} />; const view = <Action />;",
    expectedCount: 0,
  },
  {
    name: "typed parameter preserves binding identity",
    code: "export const Action = (input: {onClick: () => void}) => <button onClick={input.onClick} />;",
    expectedCount: 0,
  },
  {
    name: "nested native JSX is returned directly",
    code: "export const Action = (input) => <main><section><button onClick={input.onClick} /></section></main>;",
    expectedCount: 0,
  },
  {
    name: "shorthand fragment is returned directly",
    code: "export const Action = (input) => <><button onClick={input.onClick} /></>;",
    expectedCount: 0,
  },
  {
    name: "JSX expression children preserve direct output",
    code: "export const Action = (input) => <main>{<button onClick={input.onClick} />}</main>;",
    expectedCount: 0,
  },
  {
    name: "transparent return wrapper preserves output",
    code: "export const Action = (input) => (<button onClick={input.onClick} /> satisfies JSX.Element);",
    expectedCount: 0,
  },
  {
    name: "literal props compatibility remains",
    code: "const Action = (props) => <button onClick={props.onClick} />;",
    expectedCount: 0,
  },
  {
    name: "class props compatibility remains",
    code: "class Action { render() { return <button onClick={this.props.onClick} />; } }",
    expectedCount: 0,
  },
  {
    name: "ordinary object remains a local handler",
    code: "const input = {onClick() {}}; const view = <button onClick={input.onClick} />;",
    expectedCount: 1,
  },
  {
    name: "unreferenced Pascal callback is not evidence",
    code: "const Action = (input) => <button onClick={input.onClick} />;",
    expectedCount: 1,
  },
  {
    name: "ordinary callback usage refuses component exemption",
    code: "const Action = (input) => <button onClick={input.onClick} />; rows.map(Action);",
    expectedCount: 1,
  },
  {
    name: "export plus ordinary call refuses exemption",
    code: "export const Action = (input) => <button onClick={input.onClick} />; Action(value);",
    expectedCount: 1,
  },
  {
    name: "export plus event binding refuses exemption",
    code: "export const Action = (input) => <button onClick={input.onClick} />; const view = <main onClick={Action} />;",
    expectedCount: 1,
  },
  {
    name: "component alias refuses exemption",
    code: "export const Action = (input) => <button onClick={input.onClick} />; const other = Action;",
    expectedCount: 1,
  },
  {
    name: "reassigned parameter refuses exemption",
    code: "export const Action = (input) => { input = source; return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "replaced event prop refuses exemption",
    code: "export const Action = (input) => { input.onClick = callback; return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "parameter escape refuses exemption",
    code: "export const Action = (input) => { observe(input); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "parameter alias refuses exemption",
    code: "export const Action = (input) => { const alias = input; return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "receiver method call refuses exemption",
    code: "export const Action = (input) => { input.prepare(); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "second parameter is not props",
    code: "export const Action = (first, input) => <button onClick={input.onClick} />;",
    expectedCount: 1,
  },
  {
    name: "default parameter is outside direct profile",
    code: "export const Action = (input = source) => <button onClick={input.onClick} />;",
    expectedCount: 1,
  },
  {
    name: "destructured parameter is outside direct profile",
    code: "export const Action = ({input}) => <button onClick={input.onClick} />;",
    expectedCount: 1,
  },
  {
    name: "shadowed callback parameter is not component props",
    code: "export const Action = (input) => { return rows.map((input) => <button onClick={input.onClick} />); };",
    expectedCount: 1,
  },
  {
    name: "nested closure output is not same owner",
    code: "export const Action = (input) => { const render = () => <button onClick={input.onClick} />; return render(); };",
    expectedCount: 1,
  },
  {
    name: "HOC callback is outside direct profile",
    code: "export const Action = memo((input) => <button onClick={input.onClick} />);",
    expectedCount: 1,
  },
  {
    name: "stored JSX is outside direct output profile",
    code: "export const Action = (input) => { const output = <button onClick={input.onClick} />; return output; };",
    expectedCount: 1,
  },
  {
    name: "unreturned JSX does not establish forwarding",
    code: "export const Action = (input) => { const unused = <button onClick={input.onClick} />; return <main />; };",
    expectedCount: 1,
  },
  {
    name: "JSX passed to a helper is outside profile",
    code: "export const Action = (input) => consume(<button onClick={input.onClick} />);",
    expectedCount: 1,
  },
  {
    name: "JSX attribute payload is outside profile",
    code: "export const Action = (input) => <Panel content={<button onClick={input.onClick} />} />;",
    expectedCount: 1,
  },
  {
    name: "array output is outside profile",
    code: "export const Action = (input) => [<button onClick={input.onClick} />];",
    expectedCount: 1,
  },
  {
    name: "computed member is outside new profile",
    code: "export const Action = (input) => <button onClick={input[onClick]} />;",
    expectedCount: 1,
  },
  {
    name: "named function expression is outside profile",
    code: "export const Action = function Internal(input) { return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "mutable component binding is outside profile",
    code: "let Action = (input) => <button onClick={input.onClick} />; export { Action };",
    expectedCount: 1,
  },
  {
    name: "ordinary helper does not become component",
    code: "export const render = (input) => <button onClick={input.onClick} />;",
    expectedCount: 1,
  },
  {
    name: "prop naming convention remains enforced",
    code: "export const Action = (input) => <button callback={input.onClick} />;",
    expectedCount: 1,
  },
  {
    name: "local handler convention remains enforced",
    code: "export const Action = (input) => <button onClick={input.click} />;",
    expectedCount: 1,
  },
  {
    name: "custom public prefix is respected",
    code: "export const Action = (input) => <button whenClick={input.whenClick} />;",
    expectedCount: 0,
    settings: {
      "react-doctor": {
        jsxHandlerNames: {
          eventHandlerPropPrefix: "when",
          eventHandlerPrefix: "perform",
        },
      },
    },
  },
  {
    name: "disabled prefixes remain disabled",
    code: "export const Action = (input) => <button onClick={input.onClick} />;",
    expectedCount: 0,
    settings: {
      "react-doctor": {
        jsxHandlerNames: {
          eventHandlerPropPrefix: false,
        },
      },
    },
  },
  {
    name: "ignored component setting remains respected",
    code: "const input = {}; const view = <Ignored onClick={input.onClick} />;",
    expectedCount: 0,
    settings: {
      "react-doctor": {
        jsxHandlerNames: {
          ignoreComponentNames: ["Ignored"],
        },
      },
    },
  },
  {
    name: "inline arrow forwarding stays legacy by default",
    code: "export const Action = (input) => <button onClick={() => input.onClick()} />;",
    expectedCount: 0,
  },
  {
    name: "checked inline arrow remains outside new profile",
    code: "export const Action = (input) => <button onClick={() => input.onClick()} />;",
    expectedCount: 1,
    settings: {
      "react-doctor": {
        jsxHandlerNames: {
          checkInlineFunction: true,
        },
      },
    },
  },
  {
    name: "tagged receiver method refuses exemption",
    code: "export const Action = (input) => { input.prepare`value`; return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "constructed receiver method refuses exemption",
    code: "export const Action = (input) => { new input.prepare(); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
];

describe("jsx-handler-names forwarded component props", () => {
  for (const control of cases) {
    it(control.name, () => {
      const result = runRule(jsxHandlerNames, control.code, { settings: control.settings });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(control.expectedCount);
    });
  }
});
