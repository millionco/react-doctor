import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxHandlerNames } from "./jsx-handler-names.js";

interface ForwardedAssignmentTargetCase {
  name: string;
  code: string;
  expectedCount: number;
}

const cases: ForwardedAssignmentTargetCase[] = [
  {
    name: "unchanged-forwarding",
    code: "export const Action = (input) => {  return <button onClick={input.onClick} />; };",
    expectedCount: 0,
  },
  {
    name: "ordinary-property-read",
    code: "export const Action = (input) => { const label = input.label; return <button onClick={input.onClick} />; };",
    expectedCount: 0,
  },
  {
    name: "direct-handler-write-control",
    code: "export const Action = (input) => { input.onClick = other; return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "computed-handler-write-control",
    code: 'export const Action = (input) => { input["onClick"] = other; return <button onClick={input.onClick} />; };',
    expectedCount: 1,
  },
  {
    name: "dynamic-property-write-control",
    code: "export const Action = (input) => { input[key] = other; return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "object-assignment-handler-write",
    code: "export const Action = (input) => { ({onClick: input.onClick} = source); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "array-assignment-handler-write",
    code: "export const Action = (input) => { [input.onClick] = callbacks; return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "nested-object-assignment-handler-write",
    code: "export const Action = (input) => { ({entry: {onClick: input.onClick}} = source); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "defaulted-object-assignment-handler-write",
    code: "export const Action = (input) => { ({onClick: input.onClick = fallback} = source); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "array-rest-handler-write",
    code: "export const Action = (input) => { [...input.onClick] = callbacks; return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "object-rest-handler-write",
    code: "export const Action = (input) => { ({...input.onClick} = source); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "computed-key-object-assignment-handler-write",
    code: "export const Action = (input) => { ({[eventKey]: input.onClick} = source); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "for-of-handler-write",
    code: "export const Action = (input) => { for (input.onClick of callbacks) {} return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "for-in-handler-write",
    code: "export const Action = (input) => { for (input.onClick in source) {} return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "unrelated-property-destructuring-write",
    code: "export const Action = (input) => { ({label: input.label} = source); return <button onClick={input.onClick} />; };",
    expectedCount: 0,
  },
  {
    name: "spread-escape-control",
    code: "export const Action = (input) => { consume({...input}); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "receiver-call-control",
    code: "export const Action = (input) => { input.prepare(); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "awaited-for-of-async-owner-control",
    code: "export const Action = async (input) => { for await (input.onClick of callbacks) {} return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "default-in-another-assignment-target-reads-handler",
    code: "export const Action = (input) => { ({backup: target.backup = input.onClick} = source); return <button onClick={input.onClick} />; };",
    expectedCount: 0,
  },
  {
    name: "computed-assignment-target-key-reads-handler",
    code: "export const Action = (input) => { target[input.onClick] = other; return <button onClick={input.onClick} />; };",
    expectedCount: 0,
  },
  {
    name: "computed-destructuring-key-reads-handler",
    code: "export const Action = (input) => { ({[input.onClick]: target.value} = source); return <button onClick={input.onClick} />; };",
    expectedCount: 0,
  },
  {
    name: "computed-literal-pattern-handler-write",
    code: 'export const Action = (input) => { ({onClick: input["onClick"]} = source); return <button onClick={input.onClick} />; };',
    expectedCount: 1,
  },
  {
    name: "unknown-computed-pattern-handler-write",
    code: "export const Action = (input) => { ({onClick: input[eventKey]} = source); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "for-of-object-pattern-handler-write",
    code: "export const Action = (input) => { for ({onClick: input.onClick} of callbacks) {} return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "for-of-array-pattern-handler-write",
    code: "export const Action = (input) => { for ([input.onClick] of callbacks) {} return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "unrelated-default-target-reads-handler",
    code: "export const Action = (input) => { ({label: input.label = input.onClick} = source); return <button onClick={input.onClick} />; };",
    expectedCount: 0,
  },
  {
    name: "declaration-conditional-internal-call",
    code: "export function Action(input) { if (replay) Action(source); return <button onClick={input.onClick} />; }",
    expectedCount: 1,
  },
  {
    name: "declaration-internal-escape",
    code: "export function Action(input) { queue(Action); return <button onClick={input.onClick} />; }",
    expectedCount: 1,
  },
  {
    name: "declaration-internal-rebind",
    code: "export function Action(input) { Action = replacement; return <button onClick={input.onClick} />; }",
    expectedCount: 1,
  },
  {
    name: "arrow-conditional-internal-call-control",
    code: "export const Action = (input) => { if (replay) Action(source); return <button onClick={input.onClick} />; };",
    expectedCount: 1,
  },
  {
    name: "unchanged-declaration-forwarding-control",
    code: "export function Action(input) { return <button onClick={input.onClick} />; }",
    expectedCount: 0,
  },
  {
    name: "declaration-recursive-jsx-control",
    code: "export function Action(input) { return <main><button onClick={input.onClick} />{flag ? <Action /> : null}</main>; }",
    expectedCount: 0,
  },
  {
    name: "body-local-shadowed-component-name",
    code: "export function Action(input) { const Action = () => {}; Action(); return <button onClick={input.onClick} />; }",
    expectedCount: 0,
  },
  {
    name: "block-local-shadowed-component-name",
    code: "export function Action(input) { { const Action = local; queue(Action); } return <button onClick={input.onClick} />; }",
    expectedCount: 0,
  },
  {
    name: "nested-parameter-shadows-component-name",
    code: "export function Action(input) { const receive = (Action) => queue(Action); receive(local); return <button onClick={input.onClick} />; }",
    expectedCount: 0,
  },
];

describe("jsx-handler-names forwarded assignment targets", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(jsxHandlerNames, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
