import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidJsxNoScriptUrl } from "./solid-jsx-no-script-url.js";

describe("solid-jsx-no-script-url", () => {
  it("flags `javascript:` URLs", () => {
    const result = runRule(
      solidJsxNoScriptUrl,
      `const Foo = () => <a href="javascript:alert(1)">click</a>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag normal http URLs", () => {
    const result = runRule(
      solidJsxNoScriptUrl,
      `const Foo = () => <a href="https://example.com">click</a>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags `javascript:` URLs containing embedded control characters", () => {
    const result = runRule(
      solidJsxNoScriptUrl,
      "const Foo = () => <a href={`java\\u0009script:alert(1)`}>click</a>;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `javascript:` URLs with leading control characters and spaces", () => {
    const result = runRule(
      solidJsxNoScriptUrl,
      "const Foo = () => <a href={`\\u0001  javascript:alert(1)`}>click</a>;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
