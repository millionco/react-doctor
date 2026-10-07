import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAllCapsBodyText } from "./no-all-caps-body-text.js";

describe("no-all-caps-body-text", () => {
  it("flags long paragraph copy transformed to uppercase", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <p className="uppercase">This paragraph contains enough readable copy that forcing every word into capitals makes it harder to scan.</p>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags long literal uppercase copy", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <blockquote>THIS NOTICE CONTAINS A LONG PASSAGE THAT READERS MUST SLOW DOWN TO PARSE CORRECTLY.</blockquote>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag short uppercase labels", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <><span className="uppercase">New</span><p>IMPORTANT</p></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag sentence-case body copy", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <p>This paragraph stays in sentence case and remains comfortable to read across several words.</p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag long body copy in caseless scripts", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <><p>一部のフォルダにアクセスできないため、移動対象を検出できていない可能性があります。フォルダのアクセス権を確認してから更新してください。</p><p className="uppercase">일부 폴더에 접근할 수 없어서 이동할 항목을 찾지 못했을 수 있습니다. 폴더 접근 권한을 확인한 다음 다시 시도해 주세요.</p></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses the last duplicate inline text transform", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <><p style={{ textTransform: "uppercase", textTransform: "none" }}>This paragraph contains enough readable copy to test the effective transform value.</p><p style={{ textTransform: "none", textTransform: "uppercase" }}>This paragraph contains enough readable copy to test the effective transform value.</p></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat responsive uppercase utilities as always active", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <p className="md:uppercase">This paragraph contains enough readable copy to remain sentence case at the base breakpoint.</p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
