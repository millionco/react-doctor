import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noManufacturedContrastCopy } from "./no-manufactured-contrast-copy.js";

describe("no-manufactured-contrast-copy", () => {
  it("flags repeated contrast-first claims", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <main>
        <p>Not just another report. It is a plan.</p>
        <p>No busywork. Just useful diagnostics.</p>
        <p>Not a wall of warnings. You get prioritized fixes.</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts one deliberate contrast", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <main><p>No busywork. Just useful diagnostics.</p><p>Review the highest-impact finding first.</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts direct explanatory prose", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <article><p>The scan ranks findings by severity.</p><p>Each diagnostic links to a fix.</p><p>CI can block new warnings.</p></article>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
