import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noIconTileHeadingStack } from "./no-icon-tile-heading-stack.js";

describe("no-icon-tile-heading-stack", () => {
  it("flags a boxed icon stacked above a card heading", () => {
    const result = runRule(
      noIconTileHeadingStack,
      `const Feature = () => <article className="rounded-xl border bg-white p-6"><div className="size-12 rounded-lg bg-blue-100"><SparklesIcon /></div><h3>Automations</h3></article>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an icon aligned beside the heading", () => {
    const result = runRule(
      noIconTileHeadingStack,
      `const Feature = () => <article className="rounded-xl border bg-white p-6"><div className="flex items-center gap-3"><SparklesIcon /><h3>Automations</h3></div></article>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an unboxed icon", () => {
    const result = runRule(
      noIconTileHeadingStack,
      `const Feature = () => <article className="rounded-xl border bg-white p-6"><SparklesIcon /><h3>Automations</h3></article>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts icon wrappers with invisible surface utilities", () => {
    const result = runRule(
      noIconTileHeadingStack,
      `const Feature = () => <article className="rounded-xl border p-6"><div className="size-12 rounded-lg border-0 bg-transparent"><SparklesIcon /></div><h3>Automations</h3></article>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assemble an icon tile from conditional utilities", () => {
    const result = runRule(
      noIconTileHeadingStack,
      `const Feature = () => <article className="rounded-xl border p-6"><div className="size-12 rounded-lg dark:bg-blue-100"><SparklesIcon /></div><h3>Automations</h3></article>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes a parent card with physical padding", () => {
    const result = runRule(
      noIconTileHeadingStack,
      `const Feature = () => <article className="rounded-xl border pt-6"><div className="size-12 rounded-lg bg-blue-100"><SparklesIcon /></div><h3>Automations</h3></article>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
