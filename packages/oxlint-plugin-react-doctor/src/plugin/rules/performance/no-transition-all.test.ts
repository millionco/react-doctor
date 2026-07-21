import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTransitionAll } from "./no-transition-all.js";

describe("no-transition-all", () => {
  it('flags inline transition: "all ..."', () => {
    const code = `const A = () => <div style={{ transition: "all 200ms ease" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags inline transitionProperty: 'all' with a positive duration", () => {
    const code = `const A = () => <div style={{ transitionProperty: "all", transitionDuration: "200ms" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags all in a comma-separated transition list", () => {
    const code = `const A = () => <div style={{ transition: "opacity 200ms, all 300ms" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags all after the duration in a transition shorthand", () => {
    const code = `const A = () => <div style={{ transition: "200ms ease all" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags quoted and computed transition property keys", () => {
    const code = `const A = () => <><div style={{ "transition": "all 200ms" }} /><div style={{ ["transitionProperty"]: "all", transitionDuration: "200ms" }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags the Tailwind `transition-all` class", () => {
    const code = `const A = () => <div className="transition-all duration-200 hover:translate-y-1" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("transition-all");
  });

  it("flags `transition-all` behind a variant prefix", () => {
    const code = `const A = () => <div className="md:hover:transition-all" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags important `transition-all` utilities", () => {
    const code = `const A = () => <div className="md:!transition-all" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("lets important transition setters override normal transition-all", () => {
    const code = `const A = () => <><div className="!transition-none transition-all" /><div className="transition-none! transition-all" /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for equal-priority conflicting transition setters", () => {
    const code = `const A = () => <><div className="transition-none transition-all" /><div className="hover:transition-none hover:transition-all" /><div className="hover:!transition-none hover:transition-all!" /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses nested setters without erasing unsafe broader states", () => {
    const code = `const A = () => <><div className="transition-none hover:transition-all" /><div className="transition-all hover:transition-none" /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not let a mutually exclusive override suppress transition-all", () => {
    const code = `const A = () => <div className="motion-reduce:!transition-none motion-safe:transition-all" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags arbitrary Tailwind transition values that explicitly target all properties", () => {
    const code = `const A = () => <><div className="transition-[all]" /><div className="transition-[opacity,all]" /><div className="[transition:all]" /><div className="[transition:all_200ms]" /><div className="[transition:200ms_all]" /><div className="[transition-property:all]" /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(4);
  });

  it("requires Tailwind capability for class diagnostics", () => {
    const code = `const A = () => <><div className="transition-all" /><div style={{ transition: "all 200ms" }} /></>;`;
    const result = runRule(noTransitionAll, code, {
      settings: { "react-doctor": { capabilities: [] } },
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("respects zero-duration Tailwind overrides in matching scopes", () => {
    const code = `const A = () => <><div className="transition-all duration-0" /><div className="hover:transition-all hover:duration-0" /><div className="!transition-all !duration-0" /><div className="transition-all !duration-0" /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("respects important priority when resolving Tailwind duration", () => {
    const code = `const A = () => <><div className="!transition-all duration-0" /><div className="hover:!transition-all hover:duration-0" /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("combines arbitrary Tailwind transition targets with positive durations", () => {
    const code = `const A = () => <><div className="[transition:all] duration-200" /><div className="hover:[transition:all] hover:duration-200" /><div className="[transition-property:all] duration-[200ms]" /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("evaluates duration-only variant scopes with inherited transition targets", () => {
    const code = `const A = () => <><div className="transition-all duration-0 md:hover:duration-200" /><div className="!transition-all !duration-0 md:hover:!duration-200" /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("merges Tailwind and inline transition declarations by CSS property", () => {
    const code = `const A = () => <><div className="transition-all duration-200" style={{ transitionDuration: "0s" }} /><div className="transition-all duration-200" style={{ transitionProperty: "opacity" }} /><div className="transition-none duration-0" style={{ transitionDuration: "200ms" }} /><div className="transition-opacity duration-0" style={{ transitionDuration: "200ms" }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("lets inline transition declarations complete Tailwind transition state", () => {
    const code = `const A = () => <><div className="transition-all duration-0" style={{ transitionDuration: "200ms" }} /><div className="duration-200" style={{ transitionProperty: "all" }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("respects important Tailwind declarations over inline transition styles", () => {
    const code = `const A = () => <>
      <div className="!transition-all !duration-200" style={{ transitionProperty: "opacity" }} />
      <div className="!transition-all !duration-0" style={{ transitionDuration: "200ms" }} />
      <div className="!transition-opacity !duration-200" style={{ transitionProperty: "all" }} />
    </>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat arbitrary transition-property declarations as duration setters", () => {
    const code = `const A = () => <><div className="![transition-property:all]" style={{ transitionDuration: "200ms" }} /><div className="![transition-property:all] duration-0" style={{ transition: "opacity 200ms" }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet when an unresolved inline style may override Tailwind transitions", () => {
    const code = `const A = ({ style }) => <div className="transition-all" style={style} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves readonly const style objects and aliases", () => {
    const code = `
      const unsafeStyle = { transition: "all 200ms" };
      const unsafeAlias = unsafeStyle;
      const safeOverride = { transitionProperty: "opacity" };
      const A = () => <>
        <div style={unsafeStyle} />
        <div style={unsafeAlias} />
        <div className="transition-all" style={safeOverride} />
      </>;
    `;
    const result = runRule(noTransitionAll, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet for mutable style object bindings", () => {
    const code = `
      const changedStyle = { transition: "all 200ms" };
      changedStyle.transition = "opacity 200ms";
      let reassignedStyle = { transition: "all 200ms" };
      reassignedStyle = { transition: "opacity 200ms" };
      const A = () => <>
        <div className="transition-all" style={changedStyle} />
        <div className="transition-all" style={reassignedStyle} />
      </>;
    `;
    const result = runRule(noTransitionAll, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags statically resolvable class name branches and const bindings", () => {
    const code = `const unsafeClassName = "transition-all"; const A = ({ active }) => <><div className={unsafeClassName} /><div className={active ? "transition-opacity" : "transition-all"} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does NOT flag a compound token containing `transition-all` (Bugbot: substring match)", () => {
    const code = `const A = () => <div className="transition-all-custom" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag the bare `transition` class (curated property list, not `all`)", () => {
    const code = `const A = () => <div className="transition duration-200" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag specific transition utilities", () => {
    const code = `const A = () => <div className="transition-transform transition-colors" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a specific inline transition", () => {
    const code = `const A = () => <div style={{ transition: "transform 200ms, opacity 200ms" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag an all transition overridden by a later property", () => {
    const code = `const A = () => <div style={{ transition: "all 200ms", transition: "opacity 200ms" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag an all transition that a later spread may override", () => {
    const code = `const A = ({ style }) => <div style={{ transition: "all 200ms", ...style }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag an all transition when an earlier spread can establish longhand order", () => {
    const code = `const A = ({ style }) => <div style={{ ...style, transition: "all 200ms" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves static object spreads in inline styles", () => {
    const code = `const A = () => <><div style={{ transition: "all 200ms", ...{ color: "red" } }} /><div style={{ ...{ transition: "all 200ms" }, color: "red" }} /><div style={{ transition: "opacity 200ms", ...{ transition: "all 200ms" } }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does NOT flag a shorthand all target overridden by a later longhand", () => {
    const code = `const A = () => <div style={{ transition: "all 200ms", transitionProperty: "opacity" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a longhand all target overridden by a later shorthand", () => {
    const code = `const A = () => <div style={{ transitionProperty: "all", transition: "opacity 200ms" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags the later all target across shorthand and longhand declarations", () => {
    const code = `const A = () => <><div style={{ transitionProperty: "opacity", transition: "all 200ms" }} /><div style={{ transition: "opacity 200ms", transitionProperty: "all" }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("uses JavaScript object insertion order when duplicate transition keys overwrite values", () => {
    const code = `const A = () => <><div style={{ transition: "opacity 200ms", transitionProperty: "all", transition: "transform 200ms" }} /><div style={{ transitionProperty: "all", transition: "opacity 200ms", transitionProperty: "transform" }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag arbitrary utilities that target specific properties", () => {
    const code = `const A = () => <div className="transition-[opacity] [transition:opacity_200ms] [transition:all\\_200ms] [transition-property:transform]" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a class name that a later spread may override", () => {
    const code = `const A = (props) => <div className="transition-all" {...props} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a positive-duration transition whose property is omitted", () => {
    const code = `const A = () => <div style={{ transition: "allow-discrete 200ms" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag an invalid transitionProperty value containing an all token", () => {
    const code = `const A = () => <div style={{ transitionProperty: "opacity all" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires a positive duration and recognizes an omitted transition property as all", () => {
    const code = `const A = () => <><div style={{ transition: "all 0s" }} /><div style={{ transitionProperty: "all" }} /><div style={{ transition: "200ms ease" }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag invalid shorthands with multiple transition properties", () => {
    const code = `const A = () => <><div style={{ transition: "opacity all 200ms" }} /><div style={{ transition: "opacity transform 200ms" }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("combines transition property and duration longhands", () => {
    const code = `const A = () => <><div style={{ transition: "all", transitionDuration: "200ms" }} /><div style={{ transitionProperty: "all", transitionDuration: "200ms" }} /><div style={{ transitionDuration: "200ms" }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("respects duration overrides and shorthand resets", () => {
    const code = `const A = () => <><div style={{ transition: "all 200ms", transitionDuration: "0s" }} /><div style={{ transitionProperty: "all", transitionDuration: "0s" }} /><div style={{ transitionDuration: "200ms", transition: "all" }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("matches duration lists to transition property lists", () => {
    const code = `const A = () => <><div style={{ transitionProperty: "opacity, all", transitionDuration: "0s, 200ms" }} /><div style={{ transitionProperty: "all, opacity", transitionDuration: "0s, 200ms" }} /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("matches Tailwind duration lists to transition property lists", () => {
    const code = `const A = () => <><div className="transition-all duration-[200ms,0ms]" /><div className="transition-[opacity,all] duration-[0ms,200ms]" /><div className="[transition-property:opacity,all] [transition-duration:0ms,200ms]" /><div className="transition-[opacity,all] duration-[200ms,0ms]" /></>;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(3);
  });
});
