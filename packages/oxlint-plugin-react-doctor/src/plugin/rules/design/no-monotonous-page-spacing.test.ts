import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMonotonousPageSpacing } from "./no-monotonous-page-spacing.js";

const REPEATED_SPACING = Array.from(
  { length: 12 },
  (_, sampleIndex) => `<div className="p-4">${sampleIndex}</div>`,
).join("");

describe("no-monotonous-page-spacing", () => {
  it("flags a page dominated by one spacing value", () => {
    const result = runRule(
      noMonotonousPageSpacing,
      `const Page = () => <main>${REPEATED_SPACING}</main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reads static inline spacing", () => {
    const panels = Array.from(
      { length: 12 },
      (_, sampleIndex) => `<div style={{ padding: 16 }}>${sampleIndex}</div>`,
    ).join("");
    const result = runRule(noMonotonousPageSpacing, `const Page = () => <main>${panels}</main>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a page with varied spacing tiers", () => {
    const panels = [1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24]
      .map((spacing) => `<div className="p-${spacing}">${spacing}</div>`)
      .join("");
    const result = runRule(noMonotonousPageSpacing, `const Page = () => <main>${panels}</main>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not judge a small component sample", () => {
    const result = runRule(
      noMonotonousPageSpacing,
      `const Card = () => <main><div className="p-4">A</div><div className="p-4">B</div></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count conditional spacing variants as page samples", () => {
    const panels = Array.from(
      { length: 12 },
      (_, sampleIndex) => `<div className="hover:p-4">${sampleIndex}</div>`,
    ).join("");
    const result = runRule(noMonotonousPageSpacing, `const Page = () => <main>${panels}</main>;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
