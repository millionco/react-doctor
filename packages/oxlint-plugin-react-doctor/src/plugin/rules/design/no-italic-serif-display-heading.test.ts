import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noItalicSerifDisplayHeading } from "./no-italic-serif-display-heading.js";

describe("no-italic-serif-display-heading", () => {
  it("flags an oversized italic serif heading", () => {
    const result = runRule(
      noItalicSerifDisplayHeading,
      `const Hero = () => <h1 className="font-serif italic text-7xl">A considered approach</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts roman serif display type", () => {
    const result = runRule(
      noItalicSerifDisplayHeading,
      `const Hero = () => <h1 className="font-serif text-7xl">A considered approach</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts small editorial italics", () => {
    const result = runRule(
      noItalicSerifDisplayHeading,
      `const Quote = () => <h2 className="font-serif italic text-3xl">Editor's note</h2>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine variant-only display treatments", () => {
    const result = runRule(
      noItalicSerifDisplayHeading,
      `const Hero = () => <h1 className="font-serif dark:italic md:text-7xl">A considered approach</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
