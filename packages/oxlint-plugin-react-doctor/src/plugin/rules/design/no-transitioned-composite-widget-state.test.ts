import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTransitionedCompositeWidgetState } from "./no-transitioned-composite-widget-state.js";

const run = (code: string) => runRule(noTransitionedCompositeWidgetState, code);

describe("no-transitioned-composite-widget-state", () => {
  it("runs only when Tailwind is detected", () => {
    expect(noTransitionedCompositeWidgetState.requires).toEqual(["tailwind"]);
  });

  it("flags a selected option whose background transition uses Tailwind defaults", () => {
    const result = run(
      `const Option = ({ selected }) => <div role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]">Value</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags checked menu items using arbitrary border transitions", () => {
    const result = run(
      `const Item = ({ checked }) => <div role="menuitemcheckbox" aria-checked={checked ? "true" : "false"} className="border-[#fff] transition-[border-color] duration-100 aria-checked:border-[#000]">Value</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags current menu items using an inline color transition", () => {
    const result = run(
      `const Item = ({ current }) => <a role="menuitem" aria-current={current ? "page" : "false"} className="text-[#fff] aria-[current=page]:text-[#000]" style={{ transition: "color 120ms ease-out" }}>Value</a>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("leaves data-state styling out of v1", () => {
    const result = run(
      `const Items = ({ checked, loading }) => <><div role="treeitem" aria-checked={checked ? "true" : "false"} data-state={checked ? "checked" : "unchecked"} className="bg-[#fff] transition-colors data-[state=checked]:bg-[#000]">Value</div><div role="treeitem" aria-checked={checked ? "true" : "false"} data-state={loading ? "checked" : "unchecked"} className="bg-[#fff] transition-colors data-[state=checked]:bg-[#000]">Loading</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an ARIA-selected tree item with literal paint evidence", () => {
    const result = run(
      `const Item = ({ selected }) => <div role="treeitem" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]">Value</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("leaves data current styling out of v1", () => {
    const result = run(
      `const Item = ({ current }) => <a role="menuitem" aria-current={current ? "page" : "false"} data-state={current ? "current" : "inactive"} className="text-[#fff] transition-colors data-[state=current]:text-[#000]">Value</a>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a single const-bound target role", () => {
    const result = run(
      `const ROLE = "option"; const Option = ({ selected }) => <div role={ROLE} aria-selected={selected ? "true" : "false"} className="text-[#fff] transition-colors aria-selected:text-[#000]">Value</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags state transitions inside a stable responsive and dark scope", () => {
    const result = run(
      `const Option = ({ selected }) => <div role="option" aria-selected={selected ? "true" : "false"} className="dark:md:bg-[#fff] dark:md:transition-colors dark:md:aria-selected:bg-[#000]">Value</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags radio menu items and explicit arbitrary color declarations", () => {
    const result = run(
      `const Item = ({ checked }) => <div role="menuitemradio" aria-checked={checked ? "true" : "false"} className="[background-color:#fff] transition-[background-color] aria-checked:[background-color:#2563eb]">Value</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires a provably distinct resting paint value", () => {
    const result = run(
      `const Option = ({ selected }) => <div role="option" aria-selected={selected ? "true" : "false"} className="transition-colors aria-selected:bg-blue-600">Value</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an inline longhand transition assembled with a Tailwind duration", () => {
    const result = run(
      `const Option = ({ selected }) => <div role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] duration-100 aria-selected:bg-[#000]" style={{ transitionProperty: "background-color" }}>Value</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows tabs and other roles outside the v1 contract", () => {
    const result = run(
      `const Tabs = ({ selected }) => <><div role="tab" aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600" /><div role="radio" aria-checked={selected} className="bg-white transition-colors aria-checked:bg-blue-600" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows mixed and fallback role candidates", () => {
    const result = run(
      `const Items = ({ tree, selected }) => <><div role={tree ? "treeitem" : "option"} aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600" /><div role="option button" aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows opaque dynamic roles", () => {
    const result = run(
      `const Option = ({ role, selected }) => <div role={role} aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows custom components even when they receive a target role", () => {
    const result = run(
      `const Option = ({ selected }) => <OptionPrimitive role="option" aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows elements with spreads because ownership is not authoritative", () => {
    const result = run(
      `const Option = ({ props, selected }) => <div role="option" aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600" {...props} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires a dynamic matching ARIA state attribute", () => {
    const result = run(
      `const Options = () => <><div role="option" className="bg-white transition-colors aria-selected:bg-blue-600" /><div role="option" aria-selected="true" className="bg-white transition-colors aria-selected:bg-blue-600" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires a matching data attribute for data-state variants", () => {
    const result = run(
      `const Option = ({ selected }) => <div role="option" aria-selected={selected} className="bg-white transition-colors data-[state=selected]:bg-blue-600" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows dynamic class and style expressions", () => {
    const result = run(
      `const Options = ({ className, selected, style }) => <><div role="option" aria-selected={selected} className={className} /><div role="option" aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600" style={style} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows non-paint state feedback and transformed descendants", () => {
    const result = run(
      `const Option = ({ selected }) => <div role="option" aria-selected={selected} className="transition-transform aria-selected:scale-95"><span className="transition-transform aria-selected:scale-95" /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("leaves focus-ring transitions to the existing focus rule", () => {
    const result = run(
      `const Option = ({ selected }) => <div role="option" aria-selected={selected} className="ring-0 transition-shadow aria-selected:ring-2" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires a positive transition on the changed property", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected} className="bg-white aria-selected:bg-blue-600" /><div role="option" aria-selected={selected} className="bg-white transition-colors duration-0 aria-selected:bg-blue-600" /><div role="option" aria-selected={selected} className="bg-white transition-none duration-200 aria-selected:bg-blue-600" /><div role="option" aria-selected={selected} className="bg-white transition-opacity duration-200 aria-selected:bg-blue-600" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("leaves transition-all to the existing rule", () => {
    const result = run(
      `const Option = ({ selected }) => <div role="option" aria-selected={selected} className="bg-white transition-all duration-200 aria-selected:bg-blue-600" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows an unchanged effective state color", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected} className="bg-blue-600 transition-colors aria-selected:bg-blue-600" /><div role="option" aria-selected={selected} className="bg-blue-600 transition-colors aria-selected:bg-blue-600/100" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows ambiguous state and transition conflicts", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600 aria-selected:bg-red-600" /><div role="option" aria-selected={selected} className="bg-white transition-colors transition-none aria-selected:bg-blue-600" /><div role="option" aria-selected={selected} className="bg-white transition-colors duration-100 duration-0 aria-selected:bg-blue-600" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows important state and transition declarations", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected} className="bg-white transition-colors !aria-selected:bg-blue-600" /><div role="option" aria-selected={selected} className="bg-white !transition-colors aria-selected:bg-blue-600" /><div role="option" aria-selected={selected} className="bg-white transition-colors !duration-100 aria-selected:bg-blue-600" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows inline paint declarations that override the state utility", () => {
    const result = run(
      `const Option = ({ selected }) => <div role="option" aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600" style={{ backgroundColor: "white" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("honors inline transition overrides", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600" style={{ transitionDuration: "0ms" }} /><div role="option" aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600" style={{ transitionProperty: "opacity" }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires a state supported by the resolved role", () => {
    const result = run(
      `const Item = ({ selected }) => <div role="menuitem" aria-selected={selected} className="bg-white transition-colors aria-selected:bg-blue-600" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows state styling gated by hover or focus interaction", () => {
    const result = run(
      `const Option = ({ selected }) => <div role="option" aria-selected={selected} className="bg-white transition-colors hover:aria-selected:bg-blue-600 focus:aria-selected:bg-red-600" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows unproven state variant contexts", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected ? "true" : "false"} className="print:bg-gray-50 print:transition-colors print:aria-selected:bg-blue-600" /><div role="option" aria-selected={selected ? "true" : "false"} className="disabled:bg-gray-50 disabled:transition-colors disabled:aria-selected:bg-blue-600" /><div role="option" aria-selected={selected ? "true" : "false"} className="[&>span]:bg-gray-50 [&>span]:transition-colors [&>span]:aria-selected:bg-blue-600" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows forced-colors because its paint substitutions are not proven", () => {
    const result = run(
      `const Option = ({ selected }) => <div role="option" aria-selected={selected ? "true" : "false"} className="forced-colors:bg-[#fff] forced-colors:transition-colors forced-colors:aria-selected:bg-[#000]" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves exact variant and selector-value casing", () => {
    const result = run(
      `const Options = ({ selected, current }) => <><div role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors ARIA-selected:bg-[#000]" /><a role="menuitem" aria-current={current ? "PAGE" : "false"} className="text-[#fff] transition-colors aria-[current=PAGE]:text-[#000]" /><div role="option" aria-selected={selected ? "TRUE" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" /><div role="option" aria-selected={selected ? "true" : "false"} data-state={selected ? "SELECTED" : "idle"} className="bg-[#fff] transition-colors data-[state=SELECTED]:bg-[#000]" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires exhaustive values that can enter and leave the selector", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected} className="bg-gray-50 transition-colors aria-selected:bg-blue-600" /><div role="option" aria-selected={selected ? "mixed" : "false"} className="bg-gray-50 transition-colors aria-selected:bg-blue-600" /><div role="option" aria-selected={selected ? "true" : "true"} className="bg-gray-50 transition-colors aria-selected:bg-blue-600" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("follows a simple const alias back to a component parameter", () => {
    const result = run(
      `const Option = ({ selected }) => { const isSelected = selected; return <div role="option" aria-selected={isSelected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" />; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a selector parameter assigned before the element", () => {
    const result = run(
      `const Option = ({ selected }) => { selected = true; return <div role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows an element reached after one selector state returns early", () => {
    const result = run(
      `const Option = ({ selected }) => { if (!selected) return null; return <div role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows an element mounted in only one selector branch", () => {
    const result = run(
      `const Option = ({ selected }) => selected ? <div role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" /> : null;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires the composite element key to remain stable between selector states", () => {
    const result = run(
      `const Options = ({ selected }) => <><div key={selected} role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" /><div key={selected ? "selected" : "rest"} role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" /><div key="stable" role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows locally constant and unresolved selector conditions", () => {
    const result = run(
      `const ALWAYS_SELECTED = true; const NEVER_SELECTED = false; const Options = () => <><div role="option" aria-selected={ALWAYS_SELECTED ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" /><div role="option" aria-selected={NEVER_SELECTED ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" /><div role="option" aria-selected={externalSelected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows elements in const-resolved unreachable render branches", () => {
    const result = run(
      `const SHOW_FIRST = false; const HIDE_SECOND = true; const Options = ({ selected }) => <>{SHOW_FIRST ? <div role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" /> : null}{HIDE_SECOND ? null : <div role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" />}{SHOW_FIRST && <div role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-[#000]" />}</>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows presence selectors on attributes that never disappear", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected ? "true" : "false"} data-selected={selected ? "true" : "false"} className="bg-gray-50 transition-colors data-selected:bg-blue-600" /><div role="option" aria-selected={selected ? "true" : "false"} data-selected={selected ? "true" : "false"} className="bg-gray-50 transition-colors data-[selected]:bg-blue-600" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows canonically equivalent white, black, rgb, and alpha colors", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected ? "true" : "false"} className="bg-[white] transition-colors aria-selected:bg-[#fff]" /><div role="option" aria-selected={selected ? "true" : "false"} className="bg-[black] transition-colors aria-selected:bg-[rgb(0_0_0)]" /><div role="option" aria-selected={selected ? "true" : "false"} className="bg-[black]/50 transition-colors aria-selected:bg-[rgb(0_0_0/0.5)]" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows theme palette comparisons and palette-to-arbitrary comparisons", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected ? "true" : "false"} className="bg-gray-50 transition-colors aria-selected:bg-blue-600" /><div role="option" aria-selected={selected ? "true" : "false"} className="bg-blue-600 transition-colors aria-selected:bg-[#2563eb]" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("treats bare white and black utilities as theme-dependent", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected ? "true" : "false"} className="bg-white transition-colors aria-selected:bg-black" /><div role="option" aria-selected={selected ? "true" : "false"} className="bg-white transition-colors aria-selected:bg-[#000]" /><div role="option" aria-selected={selected ? "true" : "false"} className="bg-[#fff] transition-colors aria-selected:bg-black" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps theme-dependent and non-color utilities out of scope", () => {
    const result = run(
      `const Options = ({ selected }) => <><div role="option" aria-selected={selected} className="bg-surface transition-colors aria-selected:bg-primary" /><div role="option" aria-selected={selected} className="bg-cover transition-colors aria-selected:bg-[url('/selected.svg')]" /><div role="option" aria-selected={selected} className="text-sm transition-colors aria-selected:text-lg" /><div role="option" aria-selected={selected} className="border-2 transition-colors aria-selected:border-4" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
