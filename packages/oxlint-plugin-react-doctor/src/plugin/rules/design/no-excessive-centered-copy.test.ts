import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noExcessiveCenteredCopy } from "./no-excessive-centered-copy.js";

describe("no-excessive-centered-copy", () => {
  it("flags repeated centered paragraphs across a page", () => {
    const result = runRule(
      noExcessiveCenteredCopy,
      `const Page = () => <main><p className="text-center">Build polished interfaces with a workflow that keeps every decision visible.</p><p className="text-center">Move from an initial idea to a working result without losing important context.</p><p className="text-center">Keep the whole team aligned with clear updates and shared project history.</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts one centered introduction followed by left-aligned copy", () => {
    const result = runRule(
      noExcessiveCenteredCopy,
      `const Page = () => <main><p className="text-center">Build polished interfaces with a workflow that keeps every decision visible.</p><p>Move from an initial idea to a working result without losing important context.</p><p>Keep the whole team aligned with clear updates and shared project history.</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
