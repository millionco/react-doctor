import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { detailsRequiresSummary } from "./details-requires-summary.js";

describe("details-requires-summary", () => {
  it("reports missing and misplaced summaries", () => {
    const result = runRule(
      detailsRequiresSummary,
      `const Help = () => <><details><p>Answer</p></details><details><p>Answer</p><summary>Question</summary></details><details /></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows a first-child summary", () => {
    const result = runRule(
      detailsRequiresSummary,
      `const Help = () => <details>\n  <summary>Shipping details</summary><p>Answer</p></details>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dynamic first content and custom disclosures", () => {
    const result = runRule(
      detailsRequiresSummary,
      `const Help = ({ summary }) => <><details>{summary}<p>Answer</p></details><Details><p>Answer</p></Details></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
