import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { checkedRequiresOnchangeOrReadonly } from "./checked-requires-onchange-or-readonly.js";

describe("react-builtins/checked-requires-onchange-or-readonly — regressions", () => {
  // A spread can supply `onChange`/`readOnly` at runtime, so the
  // missing-handler report must be suppressed when one is present.
  it("stays silent when onChange/readOnly may arrive via spread", () => {
    const result = runRule(
      checkedRequiresOnchangeOrReadonly,
      `const C = ({ checked, ...rest }) => <input type="checkbox" checked={checked} {...rest} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // React's controlled-checkbox runtime warning exempts `disabled`
  // inputs — users can't toggle them, so no `onChange` is needed.
  it("stays silent for a statically disabled checkbox without onChange", () => {
    const result = runRule(
      checkedRequiresOnchangeOrReadonly,
      `const C = ({ checked }) => <input type="checkbox" checked={checked} disabled />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a dynamically disabled checkbox (it can be enabled at runtime)", () => {
    const result = runRule(
      checkedRequiresOnchangeOrReadonly,
      `const C = ({ checked, locked }) => <input type="checkbox" checked={checked} disabled={locked} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags checked + defaultChecked used together even with a spread", () => {
    const result = runRule(
      checkedRequiresOnchangeOrReadonly,
      `const C = (props) => <input type="checkbox" checked defaultChecked {...props} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Docs-validation FP (ebay/innovaccer design-system radios): forwarding
  // BOTH `checked` and `defaultChecked` as pass-through props is the
  // standard wrapper pattern — consumers supply exactly one, the other is
  // `undefined` at runtime, so no controlled/uncontrolled ambiguity exists.
  it("stays silent when checked and defaultChecked are both forwarded props", () => {
    const result = runRule(
      checkedRequiresOnchangeOrReadonly,
      `const Radio = ({ checked, defaultChecked, onChange }) => <input type="radio" checked={checked} defaultChecked={defaultChecked} onChange={onChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when checked and defaultChecked are forwarded member reads", () => {
    const result = runRule(
      checkedRequiresOnchangeOrReadonly,
      `const Radio = (props) => <input type="radio" checked={props.checked} defaultChecked={props.defaultChecked} onChange={props.onChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for the forwarded pair in createElement props", () => {
    const result = runRule(
      checkedRequiresOnchangeOrReadonly,
      `import React from "react";
      const Radio = ({ checked, defaultChecked, onChange }) => React.createElement("input", { type: "radio", checked, defaultChecked, onChange });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags when checked is a literal alongside defaultChecked", () => {
    const result = runRule(
      checkedRequiresOnchangeOrReadonly,
      `const C = ({ defaultChecked, onChange }) => <input type="checkbox" checked={true} defaultChecked={defaultChecked} onChange={onChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a forwarded pair whose defaultChecked is hard-wired", () => {
    const result = runRule(
      checkedRequiresOnchangeOrReadonly,
      `const C = ({ checked, onChange }) => <input type="checkbox" checked={checked} defaultChecked onChange={onChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
