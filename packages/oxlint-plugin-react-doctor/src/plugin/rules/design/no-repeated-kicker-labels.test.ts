import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRepeatedKickerLabels } from "./no-repeated-kicker-labels.js";

describe("no-repeated-kicker-labels", () => {
  it("flags three repeated tracked uppercase section kickers", () => {
    const result = runRule(
      noRepeatedKickerLabels,
      `const Page = () => <main>
        <section><p className="uppercase tracking-widest">Approach</p><h2>How it works</h2></section>
        <section><p className="uppercase tracking-widest">Benefits</p><h2>Why it helps</h2></section>
        <section><p className="uppercase tracking-widest">Results</p><h2>What changed</h2></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an occasional kicker", () => {
    const result = runRule(
      noRepeatedKickerLabels,
      `const Page = () => <section><p className="uppercase tracking-widest">Approach</p><h2>How it works</h2></section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count ordinary labels or non-heading pairs", () => {
    const result = runRule(
      noRepeatedKickerLabels,
      `const Page = () => <main>
        <section><p className="uppercase">Approach</p><h2>How it works</h2></section>
        <section><p className="tracking-widest">Benefits</p><h2>Why it helps</h2></section>
        <section><p className="uppercase tracking-widest">Results</p><div>Body</div></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count variant-only kicker treatments", () => {
    const result = runRule(
      noRepeatedKickerLabels,
      `const Page = () => <main>
        <section><p className="md:uppercase tracking-widest">Approach</p><h2>How it works</h2></section>
        <section><p className="uppercase md:tracking-widest">Benefits</p><h2>Why it helps</h2></section>
        <section><p className="dark:uppercase tracking-widest">Results</p><h2>What changed</h2></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
