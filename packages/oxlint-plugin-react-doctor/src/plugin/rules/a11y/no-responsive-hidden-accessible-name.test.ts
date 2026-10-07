import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResponsiveHiddenAccessibleName } from "./no-responsive-hidden-accessible-name.js";

describe("no-responsive-hidden-accessible-name", () => {
  it("reports buttons whose only text is hidden at a standard breakpoint", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button><span className="hidden md:inline">Settings</span></button><button><span className="md:hidden">Menu</span></button><button><span className="max-md:hidden">Account</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports nested and multiple contributors only when they all disappear together", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button><span className="md:hidden"><strong>Save</strong></span><span className="md:hidden">changes</span></button><button><span className="md:hidden">Open</span><span>menu</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports statically named anchors and constant intrinsic aliases", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Button = "button"; const href = "/settings"; const labelClass = "hidden md:inline"; const Actions = () => <><a href={href}><span className={labelClass}>Settings</span></a><Button><span className="lg:hidden">Close</span></Button></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not infer an intrinsic tag from an unresolved alias name", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Button = compact ? "button" : "div"; const Action = () => <Button><span className="md:hidden">Settings</span></Button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("lets a descendant visibility utility override inherited invisibility", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Action = () => <button><span className="md:invisible"><strong className="md:visible">Settings</strong></span></button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes controls that override an invisible ancestor", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Action = () => <section className="md:invisible"><button className="md:visible"><span className="md:hidden">Settings</span></button></section>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves intrinsic ancestor visibility through logical and conditional wrappers", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = ({ show, compact }) => <><section className="md:hidden">{show && <button><span className="md:hidden">Logical</span></button>}</section><section className="md:hidden">{compact ? <button><span className="md:hidden">Conditional</span></button> : null}</section></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves intrinsic ancestor visibility through rendered arrays", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Action = () => <section className="md:hidden">{[<button key="save"><span className="md:hidden">Save</span></button>]}</section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("abstains when a callback boundary prevents proving rendered ancestry", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = ({ items }) => <section className="md:hidden">{items.map(() => <button><span className="md:hidden">Save</span></button>)}</section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports static expression and numeric text contributors", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button><span className="md:hidden">{"Save"}</span></button><button><span className="md:hidden">{42}</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports immutable static strings and transparent JSX expressions", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const label = "Save"; const alias = label; const Actions = () => <><button><span className="md:hidden">{alias}</span></button><button>{(<span className="md:hidden">Open</span>)}</button><button>{(<><span className="md:hidden">Close</span></>)}</button></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("accepts persistent visible and sr-only name content", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button><span className="md:hidden">Open</span><span className="sr-only">menu</span></button><button><span className="hidden md:inline">Settings</span><span>account</span></button><a href="#profile"><span className="sr-only md:not-sr-only">Profile</span></a></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts authoritative ARIA and native naming sources", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button aria-label="Settings"><span className="md:hidden">Settings</span></button><button aria-labelledby="save-label"><span className="md:hidden">Save</span></button><button title="Open menu"><span className="md:hidden">Open</span></button><button id="delete-action"><span className="md:hidden">Delete</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dynamic or ambiguous control naming evidence", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = ({ ariaLabel, labelledBy, title, id }) => <><button aria-label={ariaLabel}><span className="md:hidden">A</span></button><button aria-labelledby={labelledBy}><span className="md:hidden">B</span></button><button title={title}><span className="md:hidden">C</span></button><button id={id}><span className="md:hidden">D</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips native, custom, interactive, and opaque descendants", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button><img alt="Settings" /><span className="md:hidden">Settings</span></button><button><Icon /><span className="md:hidden">Save</span></button><button><svg><title>Close</title></svg><span className="md:hidden">Close</span></button><button><a href="/help">Help</a><span className="md:hidden">Menu</span></button><button><span aria-label="Account" /><span className="md:hidden">Account</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat template contents as rendered name contributors", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Action = () => <button><template><span>Persistent template text</span></template><span className="md:hidden">Save</span></button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores statically excluded opaque subtrees before evaluating their contents", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = ({ dynamicClass }) => <><button><svg aria-hidden="true" className={dynamicClass}><title>Decoration</title></svg><span className="md:hidden">Save</span></button><button><img hidden alt="Decoration" className="[display:block]" /><span className="md:hidden">Open</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("skips dynamic child expressions and child prop composition", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = ({ label, children, markup }) => <><button><span className="md:hidden">{label}</span></button><button children={children}><span className="md:hidden">Save</span></button><button dangerouslySetInnerHTML={markup}><span className="md:hidden">Open</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips spreads at every relevant evidence boundary", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = ({ controlProps, labelProps, wrapperProps }) => <><button {...controlProps}><span className="md:hidden">Save</span></button><button><span {...labelProps} className="md:hidden">Open</span></button><section {...wrapperProps}><button><span className="md:hidden">Close</span></button></section></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dynamic classes, conflicting utilities, and inline styles", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = ({ className, wrapperClassName }) => <><button><span className={className}>Save</span></button><button><span className="hidden block md:hidden">Open</span></button><button><span className="md:hidden" style={{ display: "inline" }}>Close</span></button><section className={wrapperClassName}><button><span className="md:hidden">Delete</span></button></section></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips unsupported Tailwind visibility variant scopes", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button><span className="md:hidden data-[state=open]:block">Data</span></button><button><span aria-expanded="true" className="md:hidden aria-expanded:block">ARIA</span></button><button><span className="md:hidden group-hover:flex">Group</span></button><button><span className="md:invisible tablet:visible">Custom breakpoint</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips unsupported Tailwind visibility scopes on controls and ancestors", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button className="data-[ready=true]:hidden"><span className="md:hidden">Control</span></button><section className="group-hover:hidden"><button><span className="md:hidden">Ancestor</span></button></section></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("treats arbitrary display and visibility declarations as unknown", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button><span className="md:hidden [display:block]">Save</span></button><button><span className="md:invisible [visibility:visible]">Open</span></button><button><span className="md:hidden [dIsPlAy:block]">Close</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips controls hidden with their names or by an ancestor", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button className="md:hidden"><span className="md:hidden">Menu</span></button><section className="md:hidden"><button><span className="md:hidden">Save</span></button></section><button hidden><span className="md:hidden">Close</span></button><button aria-hidden="true"><span className="md:hidden">Delete</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips controls without proven interactive semantics", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = ({ href, disabled }) => <><a href={href}><span className="md:hidden">Dynamic</span></a><a href=""><span className="md:hidden">Empty</span></a><button disabled><span className="md:hidden">Disabled</span></button><button disabled={disabled}><span className="md:hidden">Maybe</span></button><button role="presentation"><span className="md:hidden">Role</span></button><div role="button"><span className="md:hidden">Custom</span></div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses presence semantics for HTML boolean attribute strings", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button disabled={"false"}><span className="md:hidden">Disabled</span></button><button hidden={"false"}><span className="md:hidden">Hidden</span></button><button inert={"false"}><span className="md:hidden">Inert</span></button><section hidden={"false"}><button><span className="md:hidden">Hidden ancestor</span></button></section><a href="/settings" disabled={"false"}><span className="md:hidden">Anchor</span></a></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("inherits disabled state from fieldset ancestors for buttons", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = ({ isDisabled }) => <><fieldset disabled><button><span className="md:hidden">Static</span></button></fieldset><fieldset disabled={"false"}><button><span className="md:hidden">String</span></button></fieldset><fieldset disabled={isDisabled}><button><span className="md:hidden">Dynamic</span></button></fieldset><fieldset disabled={false}><button><span className="md:hidden">Enabled</span></button></fieldset><fieldset disabled><a href="/settings"><span className="md:hidden">Anchor</span></a></fieldset></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("suppresses statically inert and dynamically inert controls", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = ({ isInert }) => <><button inert><span className="md:hidden">Save</span></button><section inert><button><span className="md:hidden">Open</span></button></section><button inert={isInert}><span className="md:hidden">Close</span></button><section inert={isInert}><button><span className="md:hidden">Delete</span></button></section></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat disabled as an anchor state", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Action = () => <a href="/settings" disabled><span className="md:hidden">Settings</span></a>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips controls inside labels, custom component boundaries, and JSX prop values", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><label>External name<button><span className="md:hidden">Save</span></button></label><Wrapper><button><span className="md:hidden">Open</span></button></Wrapper><Composer action={<button><span className="md:hidden">Close</span></button>} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips wrapped controls across custom prop, render, and child boundaries", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = ({ condition }) => <><Composer actions={[<button><span className="md:hidden">Array prop</span></button>]} /><Composer action={condition ? <button><span className="md:hidden">Conditional prop</span></button> : null} /><Composer render={() => <button><span className="md:hidden">Render</span></button>} /><Wrapper>{condition && <button><span className="md:hidden">Logical child</span></button>}</Wrapper></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips non-JSX component props and expressions that do not prove rendering", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const unused = <button><span className="md:hidden">Unused</span></button>; const Actions = () => <><div>{() => <button><span className="md:hidden">Function child</span></button>}</div>{(<button><span className="md:hidden">Discarded</span></button>, null)}</>; const Created = () => createElement(Composer, { action: <button><span className="md:hidden">Prop</span></button> });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps wrapped controls under proven intrinsic JSX ancestors", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Action = () => <section>{(<button><span className="md:hidden">Save</span></button>)}</section>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips controls that never have an accessible-name contributor", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button /><button><span className="hidden">Always hidden</span></button><button><span aria-hidden="true">Always hidden</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips Tailwind generated-content alternatives", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Actions = () => <><button className="before:content-['Save']"><span className="md:hidden">Save</span></button><button><span className="after:content-['menu'] md:hidden">Open</span></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips mixed-case arbitrary generated-content alternatives", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Action = () => <button className="before:[CoNtEnT:'Save']"><span className="md:hidden">Save</span></button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not run when Tailwind is explicitly unavailable", () => {
    const result = runRule(
      noResponsiveHiddenAccessibleName,
      `const Action = () => <button><span className="md:hidden">Save</span></button>;`,
      { settings: { "react-doctor": { capabilities: [] } } },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
