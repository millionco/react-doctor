import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noExcessivePillTreatment } from "./no-excessive-pill-treatment.js";

describe("no-excessive-pill-treatment", () => {
  it("flags a page that turns every short label into a pill", () => {
    const result = runRule(
      noExcessivePillTreatment,
      `const Page = () => <main><span className="rounded-full border px-3">Fast</span><span className="rounded-full bg-blue-100 px-3">Secure</span><button className="rounded-full border px-4">Start</button><a className="rounded-full bg-black px-4">Docs</a><div className="rounded-full border px-3">New</div></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a small tag group", () => {
    const result = runRule(
      noExcessivePillTreatment,
      `const Tags = () => <main><span className="rounded-full border px-3">React</span><span className="rounded-full border px-3">TypeScript</span><span className="rounded-full border px-3">Oxc</span></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores long rounded content surfaces", () => {
    const result = runRule(
      noExcessivePillTreatment,
      `const Page = () => <main>${Array.from({ length: 5 }, (_, index) => `<p className="rounded-full border px-4">This is a deliberately long sentence for content row number ${index}.</p>`).join("")}</main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
