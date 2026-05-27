import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoUnknownNamespaces } from "./solid-no-unknown-namespaces.js";

describe("solid-no-unknown-namespaces", () => {
  it("accepts known namespaces like `on:`", () => {
    const result = runRule(
      solidNoUnknownNamespaces,
      `const Foo = () => <div on:click={() => {}} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags unknown namespaces", () => {
    const result = runRule(solidNoUnknownNamespaces, `const Foo = () => <div data:foo="x" />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("data:");
  });

  it("flags style-namespace usage with a hint to use the property directly", () => {
    const result = runRule(
      solidNoUnknownNamespaces,
      `const Foo = () => <div style:color="red" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("style");
  });

  it("flags namespaces on components", () => {
    const result = runRule(
      solidNoUnknownNamespaces,
      `const Foo = () => <Bar on:click={() => {}} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Namespaced");
  });
});
