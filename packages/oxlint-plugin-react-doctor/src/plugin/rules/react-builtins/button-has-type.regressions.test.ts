import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { buttonHasType } from "./button-has-type.js";

describe("react-builtins/button-has-type — regressions", () => {
  // Bugbot review: bare `<button type />` is shorthand for
  // `type={true}` — should be flagged as invalid type, not silently
  // accepted via `if (!value) return`.
  it("flags bare <button type />", () => {
    const result = runRule(buttonHasType, `<button type />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // A spread can forward `type` at runtime, so a button with only a
  // spread and no explicit `type` must not be flagged as missing.
  it("stays silent on <button {...props} /> (type may come via spread)", () => {
    const result = runRule(buttonHasType, `const Button = (props) => <button {...props} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an explicit invalid literal type alongside a spread", () => {
    const result = runRule(
      buttonHasType,
      `const Button = (props) => <button {...props} type="foo" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // A local const that resolves to a provably valid literal type is
  // correct — resolve the identifier to its initializer before failing.
  it("stays silent on a local const that resolves to a valid type", () => {
    const result = runRule(
      buttonHasType,
      `function Save() { const kind = "submit"; return <button type={kind}>Save</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // An identifier with no resolvable initializer stays "unknown →
  // invalid" and must fire.
  it("still flags an unresolvable identifier type", () => {
    const result = runRule(buttonHasType, `<button type={dynamicUnknown}>x</button>`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // FP wave 4: a RENAMED destructured `type` prop (`({ type: kind })`)
  // is still a consumer forward — the real value lives at the call site,
  // so the wrapper must not eat a diagnostic.
  it("stays silent on a renamed destructured type prop forward", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ type: kind }) => <button type={kind}>x</button>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // …but an identifier destructured from a DIFFERENT key is not a `type`
  // forward and stays "unknown → invalid".
  it("still flags an identifier destructured from a non-type key", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ kind }) => <button type={kind}>x</button>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // fp-review PR991: resolution through a `let` is not proof — the
  // binding can be reassigned to an unknown value before render.
  it("still flags a let binding even when initialized to a valid type", () => {
    const result = runRule(
      buttonHasType,
      `function App({ dynamic }) { let kind = "submit"; kind = dynamic; return <button type={kind}>x</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // fp-review PR991: a destructured `type` key is only a consumer forward
  // when the pattern roots at a function PARAMETER — a destructure of a
  // local object literal keeps the (invalid) value statically visible.
  it("still flags a type destructured from a local object literal", () => {
    const result = runRule(
      buttonHasType,
      `function App() { const { type: kind } = { type: "banana" }; return <button type={kind}>x</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a type destructured from a dynamic local source", () => {
    const result = runRule(
      buttonHasType,
      `function App({ raw }) { const { type: kind } = JSON.parse(raw); return <button type={kind}>x</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // …but a destructure OF A PARAM IDENTIFIER (`const { type } = props`)
  // is still the wrapper forward — the value lives at the call site.
  it("stays silent on a type destructured from a props param", () => {
    const result = runRule(
      buttonHasType,
      `const Button = (props) => { const { type: kind } = props; return <button type={kind}>x</button>; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // fp-review PR991: a param DEFAULT only applies when the caller omits
  // the arg — a caller-passed invalid value is unchecked, so the default
  // is not proof of validity.
  it("still flags a destructured param with a valid default", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ kind = "button" }) => <button type={kind}>x</button>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a positional param with a valid default", () => {
    const result = runRule(
      buttonHasType,
      `const Button = (kind = "submit") => <button type={kind}>x</button>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot: a QUOTED destructured `type` key (`{ "type": kind }`) is the same
  // consumer forward as the bare-identifier key.
  it("stays silent on a quoted renamed destructured type prop forward", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ "type": kind }) => <button type={kind}>x</button>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Bugbot: the createElement arm must mirror the JSX spread bailout — a
  // spread-only props object may supply `type` at runtime.
  it("stays silent on createElement('button', { ...props })", () => {
    const result = runRule(
      buttonHasType,
      `const Button = (props) => React.createElement("button", { ...props });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on createElement('button', props) with an opaque props bag", () => {
    const result = runRule(
      buttonHasType,
      `const Button = (props) => React.createElement("button", props);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags createElement('button', { type: 'foo' }) with an invalid type", () => {
    const result = runRule(
      buttonHasType,
      `React.createElement("button", { ...rest, type: "foo" });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags createElement('button', {}) with no type and no spread", () => {
    const result = runRule(buttonHasType, `React.createElement("button", {});`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot: nullish props (undefined / void 0) carry no type, like an explicit
  // null — they must still report missing, not be treated as an opaque bag.
  it("still flags createElement('button', undefined)", () => {
    const result = runRule(buttonHasType, `React.createElement("button", undefined);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags createElement('button', void 0)", () => {
    const result = runRule(buttonHasType, `React.createElement("button", void 0);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
