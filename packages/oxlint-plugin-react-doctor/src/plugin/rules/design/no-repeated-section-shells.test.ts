import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRepeatedSectionShells } from "./no-repeated-section-shells.js";

describe("no-repeated-section-shells", () => {
  it("flags repeated padded section and centered-container scaffolds", () => {
    const result = runRule(
      noRepeatedSectionShells,
      `const Page = () => <main><section className="py-20"><div className="mx-auto max-w-6xl">Intro</div></section><section className="py-24"><div className="mx-auto max-w-6xl">Features</div></section><section className="py-20"><div className="mx-auto max-w-6xl">Pricing</div></section></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts sections with varied composition", () => {
    const result = runRule(
      noRepeatedSectionShells,
      `const Page = () => <main><section className="py-20"><div className="mx-auto max-w-6xl">Intro</div></section><section className="grid min-h-dvh">Demo</section><section className="px-6">Story</section></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
