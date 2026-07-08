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

  // A TS assertion wrapper (`as const` / `satisfies`) around a valid
  // literal is the type-safest way to write the binding — strip the
  // wrapper before proving validity.
  it("stays silent on a local const with an `as const` valid type", () => {
    const result = runRule(
      buttonHasType,
      `function Save() { const kind = "submit" as const; return <button type={kind}>Save</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an inline `satisfies`-wrapped valid type", () => {
    const result = runRule(
      buttonHasType,
      `const Save = () => <button type={"submit" satisfies "submit"}>Save</button>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an `as const` INVALID literal type", () => {
    const result = runRule(
      buttonHasType,
      `function Save() { const kind = "banana" as const; return <button type={kind}>Save</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
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

  // FP wave 2b (suomifi HtmlButton): `type={!!type ? type : 'button'}` is
  // the ternary spelling of the documented `type={type ?? 'button'}`
  // defaulted forward — the consumer's literal lives at the call site.
  it("stays silent on a ternary-guarded type prop forward", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ type, ...rest }) => <button {...rest} type={!!type ? type : "button"} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // FP wave 2b (innovaccer Button): a const bound to a guarded conditional
  // forward (`cond ? 'button' : type`) is the same defaulted forward one
  // hop away — resolve the const and re-test the forwarding shape.
  it("stays silent on a const bound to a guarded conditional type forward", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ type, disabled }) => {
        const renderedType = disabled && (type === "submit" || !type) ? "button" : type;
        return <button type={renderedType}>x</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // …but a ternary whose fallback is INVALID is not a safe forward.
  it("still flags a ternary type forward with an invalid fallback", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ type }) => <button type={type ? type : "banana"} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // …and a ternary between two non-forward unknowns keeps firing — no
  // branch carries the consumer's `type` prop.
  it("still flags a ternary between unknown identifiers", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ kind, fallback }) => <button type={kind ? kind : fallback} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // FP wave 2b (ant-design / classicy): a RENAMED prop forward whose
  // destructuring default is a valid literal (`({ htmlType = 'button' })`)
  // renders the consumer's value or the safe default — never undefined.
  it("stays silent on a renamed prop forward with a valid destructuring default", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ htmlType = "button", ...rest }) => <button {...rest} type={htmlType} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a renamed prop forward defaulted from a nested props destructure", () => {
    const result = runRule(
      buttonHasType,
      `const Button = (props) => {
        const { buttonType = "submit" } = props;
        return <button type={buttonType}>x</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // …a renamed prop with NO default can be undefined at render — the
  // implicit-submit hazard the rule exists for.
  it("still flags a renamed prop forward without a default", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ htmlType }) => <button type={htmlType} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // …and an invalid default is no safer than none.
  it("still flags a renamed prop forward with an invalid default", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ htmlType = "banana" }) => <button type={htmlType} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // FN hunt (easy-ui UnstyledPressButton / PressableButton): a spread of
  // react-aria's `pressProps` provably cannot carry `type` — the button
  // defaults to submit and must be flagged despite the spread.
  it("flags <button {...pressProps}> from react-aria usePress", () => {
    const result = runRule(
      buttonHasType,
      `import React, { forwardRef } from "react";
       import { usePress } from "react-aria";
       export const UnstyledPressButton = forwardRef((props, ref) => {
         const { pressProps } = usePress(props);
         return <button {...pressProps} ref={ref} className={pressProps.className} />;
       });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // FN hunt (easy-ui CopyButton): the spread bag comes from a same-file
  // hook returning `mergeProps(hoverProps, focusProps)` — every input is a
  // type-free react-aria bag, so the button still lacks a `type`.
  it("flags <button {...triggerProps}> from a local hook merging react-aria bags", () => {
    const result = runRule(
      buttonHasType,
      `import React from "react";
       import { mergeProps, useFocus, useHover } from "react-aria";
       export function CopyButton({ text }) {
         const { tooltipState, triggerProps } = useCopyButtonTooltipState();
         return <button className="x" onClick={() => {}} {...triggerProps}>copy</button>;
       }
       function useCopyButtonTooltipState() {
         const tooltipState = { open() {}, close() {} };
         const { hoverProps } = useHover({});
         const { focusProps } = useFocus({});
         return { triggerProps: mergeProps(hoverProps, focusProps), tooltipState };
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a spread of a local object literal without a type key", () => {
    const result = runRule(
      buttonHasType,
      `const Button = ({ onClick }) => {
        const handlers = { onClick };
        return <button {...handlers}>x</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the spread object literal carries a type key", () => {
    const result = runRule(
      buttonHasType,
      `const Button = () => {
        const handlers = { type: "button", onClick: () => {} };
        return <button {...handlers}>x</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a spread of an unknown call result", () => {
    const result = runRule(
      buttonHasType,
      `const Button = () => <button {...getButtonProps()}>x</button>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a destructured bag from an unknown hook", () => {
    const result = runRule(
      buttonHasType,
      `import { useButton } from "react-aria";
       const Button = (props) => {
         const { buttonProps } = useButton(props);
         return <button {...buttonProps}>x</button>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // …a local destructure of a non-param object is not a consumer prop.
  it("still flags a defaulted destructure of a local object", () => {
    const result = runRule(
      buttonHasType,
      `const Button = () => {
        const { htmlType = "button" } = JSON.parse(localStorage.getItem("cfg") ?? "{}");
        return <button type={htmlType}>x</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
