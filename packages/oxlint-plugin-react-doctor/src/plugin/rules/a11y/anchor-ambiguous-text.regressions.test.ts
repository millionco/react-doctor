import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { anchorAmbiguousText } from "./anchor-ambiguous-text.js";

describe("a11y/anchor-ambiguous-text regressions", () => {
  it("exempts adjacent elements with no whitespace text node between them", () => {
    // DOM accessible name is "learnmore" (one word), not the ambiguous
    // "learn more" — joining child parts must not invent a word break.
    const result = runRule(anchorAmbiguousText, `<a><span>learn</span><span>more</span></a>`);
    expect(result.diagnostics).toEqual([]);
  });

  for (const code of [
    `<a>a<i></i> link</a>`,
    `<a><span>click</span> here</a>`,
    `<a><span> click </span> here</a>`,
    `<a><CustomElement>click</CustomElement> here</a>`,
  ]) {
    it(`still flags genuine whitespace-separated ambiguous text in ${code}`, () => {
      expect(runRule(anchorAmbiguousText, code).diagnostics).toHaveLength(1);
    });
  }

  // Prettier inserts explicit `{" "}` between wrapped JSX children — that
  // string-literal expression is a real word break in the accessible name.
  for (const code of [
    `<a>learn{" "}more</a>`,
    `<a><span>learn</span>{" "}more</a>`,
    `<a><span>click</span>{" "}<span>here</span></a>`,
  ]) {
    it(`flags ambiguous text separated by an explicit {" "} in ${code}`, () => {
      expect(runRule(anchorAmbiguousText, code).diagnostics).toHaveLength(1);
    });
  }
});
