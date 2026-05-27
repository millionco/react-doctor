import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidPreferClasslist } from "./solid-prefer-classlist.js";

describe("solid-prefer-classlist", () => {
  it("flags cn() with a single object argument on class prop", () => {
    const result = runRule(
      solidPreferClasslist,
      `const Foo = () => <div class={cn({ active: true })} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("classlist");
    expect(result.diagnostics[0].message).toContain("cn");
  });

  it("flags clsx() with a single object argument on className prop", () => {
    const result = runRule(
      solidPreferClasslist,
      `const Foo = () => <div className={clsx({ highlight: isActive })} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("clsx");
  });

  it("flags classnames() with a single object argument", () => {
    const result = runRule(
      solidPreferClasslist,
      `const Foo = () => <div class={classnames({ open: isOpen })} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("classnames");
  });

  it("does not flag when classlist attribute already exists", () => {
    const result = runRule(
      solidPreferClasslist,
      `const Foo = () => <div class={cn({ active: true })} classlist={{ bold: isBold }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag cn() with multiple arguments", () => {
    const result = runRule(
      solidPreferClasslist,
      `const Foo = () => <div class={cn("base", { active: true })} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag cn() with a non-object argument", () => {
    const result = runRule(
      solidPreferClasslist,
      `const Foo = () => <div class={cn("some-class")} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag static string class prop", () => {
    const result = runRule(solidPreferClasslist, `const Foo = () => <div class="static" />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-class attributes", () => {
    const result = runRule(
      solidPreferClasslist,
      `const Foo = () => <div data-x={cn({ active: true })} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag unknown function names", () => {
    const result = runRule(
      solidPreferClasslist,
      `const Foo = () => <div class={myHelper({ active: true })} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
