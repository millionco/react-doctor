import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGenericMarketingCopy } from "./no-generic-marketing-copy.js";

describe("no-generic-marketing-copy", () => {
  it("flags a generic promise in page copy", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main><h1>Supercharge your workflow</h1><p>Move faster.</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a nested article only through its page root", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main><article><p>Build a future-proof platform.</p></article></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts concrete product copy", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main><h1>Review React diagnostics before merge</h1><p>Scan changed files locally or in CI.</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not judge an isolated component label", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Badge = () => <span>Next-generation</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
