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
});
