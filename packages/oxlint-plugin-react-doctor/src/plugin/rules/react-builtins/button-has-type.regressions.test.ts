import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { buttonHasType } from "./button-has-type.js";

describe("react-builtins/button-has-type — regressions", () => {
  it("stays silent for a button without a form owner", () => {
    const result = runRule(
      buttonHasType,
      `const Outside = () => <main><button>Open menu</button></main>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a button without a type inside an intrinsic form", () => {
    const result = runRule(
      buttonHasType,
      `const Inside = () => <form><button>Save</button></form>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a button with a literal associated form", () => {
    const result = runRule(
      buttonHasType,
      `const Associated = () => <><form id="settings" /><button form="settings">Save</button></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not invent a form owner from a custom component", () => {
    const result = runRule(
      buttonHasType,
      `const InsideCustom = () => <Form><button>Save</button></Form>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("requires a statically nonempty associated form id", () => {
    const result = runRule(
      buttonHasType,
      `const Buttons = ({ formId }) => <><button form="">Empty</button><button form={formId}>Dynamic</button></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("applies form ownership to createElement buttons", () => {
    const outsideResult = runRule(buttonHasType, `React.createElement("button", null, "Open");`);
    const nestedResult = runRule(
      buttonHasType,
      `React.createElement("form", null, React.createElement("button", null, "Save"));`,
    );
    const associatedResult = runRule(
      buttonHasType,
      `React.createElement("button", { form: "settings" }, "Save");`,
    );
    expect(outsideResult.parseErrors).toEqual([]);
    expect(outsideResult.diagnostics).toEqual([]);
    expect(nestedResult.parseErrors).toEqual([]);
    expect(nestedResult.diagnostics).toHaveLength(1);
    expect(associatedResult.parseErrors).toEqual([]);
    expect(associatedResult.diagnostics).toHaveLength(1);
  });

  it("treats an exact const string JSX alias as a button", () => {
    const invalidResult = runRule(
      buttonHasType,
      'const ButtonTag = "button" as const; const Save = () => <form><ButtonTag>Save</ButtonTag></form>;',
    );
    const validResult = runRule(
      buttonHasType,
      'const ButtonTag = "button" as const; const Save = () => <ButtonTag type="button">Save</ButtonTag>;',
    );
    expect(invalidResult.parseErrors).toEqual([]);
    expect(invalidResult.diagnostics).toHaveLength(1);
    expect(validResult.parseErrors).toEqual([]);
    expect(validResult.diagnostics).toEqual([]);
  });

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

  it("still flags an explicit invalid literal type after a known unrelated spread", () => {
    const result = runRule(
      buttonHasType,
      `const Button = () => <button {...{ disabled: true }} type="foo" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it.each(["curated", "strict"])(
    "reports only the final invalid type in %s mode",
    (portedRuleMode) => {
      const result = runRule(
        buttonHasType,
        `import React from "react";
      const Buttons = (props) => <form>
        <button type="invalid" {...{ type: "button" }} />
        <button type="button" {...{ type: "invalid" }} />
        {React.createElement("button", { type: "invalid", ...{ type: "button" } })}
        {React.createElement("button", { type: "button", ...{ type: "invalid" } })}
        <button {...{ type: "invalid" }} type="button" />
        <button {...{ type: "button" }} type="invalid" />
        <button type="invalid" {...props} />
        <button type="invalid" {...{ disabled: true }} />
      </form>;`,
        { settings: { "react-doctor": { portedRuleMode } }, includeLocations: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([4, 6, 8, 10]);
    },
  );

  it.each([
    ["nested JSX spread", `<button type="button" {...{ ...{ type: "invalid" } }} />`, 1],
    ["nested props spread", `React.createElement("button", { ...{ ...{ type: "invalid" } } })`, 1],
    ["duplicate type key", `React.createElement("button", { type: "invalid", type: "button" })`, 0],
    [
      "invalid duplicate type",
      `React.createElement("button", { type: "button", type: "invalid" })`,
      1,
    ],
    [
      "opaque later object spread",
      `React.createElement("button", { type: "invalid", ...props })`,
      0,
    ],
    ["opaque nested spread", `<button type="invalid" {...{ ...props }} />`, 0],
    ["later write after opaque nested spread", `<button {...{ ...props, type: "invalid" }} />`, 0],
    [
      "unrelated nested spread",
      `React.createElement("button", { type: "invalid", ...{ ...{ disabled: true } } })`,
      1,
    ],
    ["getter of type", `<button type="invalid" {...{ get type() { return props.type; } }} />`, 0],
    [
      "getter before the final data property",
      `React.createElement("button", { ...{ get type() { return "button"; } }, type: "invalid" })`,
      1,
    ],
    [
      "dynamic computed key",
      `React.createElement("button", { type: "invalid", [props.key]: "button" })`,
      0,
    ],
    ["static computed type key", `<button type="invalid" {...{ ["type"]: "button" }} />`, 0],
    ["known unrelated computed key", `<button type="invalid" {...{ ["disabled"]: true }} />`, 1],
    ["null spread", `<button type="invalid" {...null} />`, 1],
    ["string spread", `<button type="invalid" {..."button"} />`, 1],
    ["negative number spread", `<button type="invalid" {...(-1)} />`, 1],
    ["unary plus spread", `<button type="invalid" {...(+1)} />`, 1],
    ["negative bigint spread", `<button type="invalid" {...(-1n)} />`, 1],
    ["boolean negation spread", `<button type="invalid" {...(!false)} />`, 1],
    ["typeof spread", `<button type="invalid" {...(typeof false)} />`, 1],
    ["bitwise negation spread", `React.createElement("button", { type: "invalid", ...(~0) })`, 1],
    ["regular expression spread", `<button type="invalid" {.../x/} />`, 1],
    [
      "regular expression computed key has unknown coercion",
      `React.createElement("button", { type: "invalid", [/x/]: "button" })`,
      0,
    ],
    ["boolean props spread", `React.createElement("button", { type: "invalid", ...false })`, 1],
    ["setter-only type", `React.createElement("button", { set type(value) {} })`, 1],
    ["setter-only type in JSX spread", `<button {...{ set type(value) {} }} />`, 1],
    [
      "paired getter and setter type stays unknown",
      `React.createElement("button", { get type() { return "button"; }, set type(value) {} })`,
      0,
    ],
    [
      "setter replaces a spread data property",
      `React.createElement("button", { ...{ get type() { return "button"; } }, set type(value) {} })`,
      1,
    ],
    [
      "later valid data property replaces a setter",
      `React.createElement("button", { set type(value) {}, type: "button" })`,
      0,
    ],
    [
      "getter replacing an invalid type before it is copied",
      `<button {...{ get disabled() { this.type = "button"; return false; }, type: "invalid" }} />`,
      0,
    ],
    [
      "getter replacing a valid type before it is copied",
      `React.createElement("button", { get disabled() { this.type = "invalid"; return false; }, type: "button" })`,
      0,
    ],
    [
      "getter copied before the final JSX attribute",
      `<button {...{ get disabled() { this.type = "button"; return false; }, type: "button" }} type="invalid" />`,
      1,
    ],
    ["mixed direct JSX spellings", `<button type="invalid" TYPE="button" />`, 0],
    ["mixed spread JSX spellings", `<button type="invalid" {...{ ...{ TYPE: "button" } }} />`, 0],
    [
      "same uppercase JSX spelling, final valid",
      `<button TYPE="invalid" {...{ TYPE: "button" }} />`,
      0,
    ],
    [
      "same uppercase JSX spelling, final invalid",
      `<button TYPE="button" {...{ ...{ TYPE: "invalid" } }} />`,
      1,
    ],
    ["uppercase object type is present", `React.createElement("button", { TYPE: "button" })`, 0],
    [
      "same uppercase object spelling, final invalid",
      `React.createElement("button", { TYPE: "button", ...{ TYPE: "invalid" } })`,
      1,
    ],
    ["earlier opaque JSX spread can reserve key order", `<button {...props} type="invalid" />`, 0],
    [
      "earlier opaque object spread can reserve key order",
      `React.createElement("button", { ...props, type: "invalid" })`,
      0,
    ],
    [
      "computed JSX key can collide with duplicate type",
      `<button {...{ type: "submit", [props.key]: "button", type: "invalid" }} />`,
      0,
    ],
    [
      "computed object key can collide with duplicate type",
      `React.createElement("button", { type: "submit", [props.key]: "button", type: "invalid" })`,
      0,
    ],
    ["known numeric key", `<button type="invalid" {...{ 0: "unrelated" }} />`, 1],
    ["known computed numeric key", `<button type="invalid" {...{ [0]: "unrelated" }} />`, 1],
    ["known computed boolean key", `<button type="invalid" {...{ [false]: "unrelated" }} />`, 1],
    [
      "known computed numeric object key",
      `React.createElement("button", { type: "invalid", [0]: "unrelated" })`,
      1,
    ],
    [
      "mixed object spellings",
      `React.createElement("button", { type: "invalid", ["TYPE"]: "button" })`,
      0,
    ],
    [
      "own prototype setter",
      `React.createElement("button", { ...{ ["__proto__"]: { set type(value) {} } }, type: "invalid" })`,
      0,
    ],
    [
      "object spread ignores inherited type",
      `<button type="invalid" {...{ __proto__: { type: "button" } }} />`,
      1,
    ],
    [
      "exact createElement type key",
      `React.createElement("button", { Type: "invalid", type: "button" })`,
      0,
    ],
    ["case-insensitive JSX attribute", `<button Type="invalid" />`, 1],
    [
      "consumer-provided type in nested spread",
      `<button type="invalid" {...{ ...{ type: props.type } }} />`,
      0,
    ],
    [
      "type-free nested props in form",
      `React.createElement("button", { ...{ ...{ disabled: true } } })`,
      1,
    ],
  ])("preserves the precedence boundary for %s", (_name, button, expectedCount) => {
    const result = runRule(buttonHasType, `const Buttons = (props) => <form>{${button}}</form>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });

  it.each(["curated", "strict"])(
    "stays quiet for object rest that can still override an HTML type in %s mode",
    (portedRuleMode) => {
      const result = runRule(
        buttonHasType,
        `const Button = ({ type, ...rest }) => {
          const alias = type;
          return <button type={alias} {...rest} />;
        };
        <Button type="invalid" TYPE="button" />;
        const EvalButton = ({ type, ...rest }) => {
          eval('rest.type = "button"');
          return <button type="invalid" {...rest} />;
        };`,
        { settings: { "react-doctor": { portedRuleMode } } },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

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

  it("still flags createElement with an invalid type after a known unrelated spread", () => {
    const result = runRule(
      buttonHasType,
      `React.createElement("button", { ...{ disabled: true }, type: "foo" });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags createElement('button', {}) with no type and no spread", () => {
    const result = runRule(buttonHasType, `React.createElement("button", { form: "settings" });`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot: nullish props (undefined / void 0) carry no type, like an explicit
  // null — they must still report missing, not be treated as an opaque bag.
  it("still flags createElement('button', undefined)", () => {
    const result = runRule(
      buttonHasType,
      `React.createElement("form", null, React.createElement("button", undefined));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags createElement('button', void 0)", () => {
    const result = runRule(
      buttonHasType,
      `React.createElement("form", null, React.createElement("button", void 0));`,
    );
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
         return <form><button {...pressProps} ref={ref} className={pressProps.className} /></form>;
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
         return <form><button className="x" onClick={() => {}} {...triggerProps}>copy</button></form>;
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
        return <form><button {...handlers}>x</button></form>;
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
