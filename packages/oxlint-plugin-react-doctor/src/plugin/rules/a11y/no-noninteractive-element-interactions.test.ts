import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNoninteractiveElementInteractions } from "./no-noninteractive-element-interactions.js";

describe("a11y/no-noninteractive-element-interactions", () => {
  it("allows handlers on presentation-role delegation wrappers with an interactive descendant", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<article role="presentation" onClick={() => {}}><button>Open</button></article>`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("reports handlers on non-interactive elements with non-interactive roles", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<article role="article" onClick={() => {}}>Open</article>`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows handlers when the element has an interactive role", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<article role="button" onClick={() => {}}>Open</article>`,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
