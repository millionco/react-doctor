import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSkippedHeadingLevel } from "./no-skipped-heading-level.js";

describe("no-skipped-heading-level", () => {
  it("flags a static h1 to h3 jump inside main", () => {
    const result = runRule(
      noSkippedHeadingLevel,
      `const Page = () => <main><h1>Title</h1><section><h3>Details</h3></section></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags heading jumps through JSX fragments", () => {
    const result = runRule(
      noSkippedHeadingLevel,
      `const Page = () => <main><><h1>Title</h1><><h3>Details</h3></></></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a continuous heading hierarchy", () => {
    const result = runRule(
      noSkippedHeadingLevel,
      `const Page = () => <main><h1>Title</h1><section><h2>Details</h2><h3>More</h3></section></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer hierarchy across component boundaries", () => {
    const result = runRule(
      noSkippedHeadingLevel,
      `const Page = () => <main><PageTitle /><SectionHeading /></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not double-report nested article roots", () => {
    const result = runRule(
      noSkippedHeadingLevel,
      `const Page = () => <main><h1>Title</h1><article><h2>Article</h2><h4>Detail</h4></article></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
