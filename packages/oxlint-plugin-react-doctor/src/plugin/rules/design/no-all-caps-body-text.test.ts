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

  it("does not flag long Japanese text (caseless script)", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <p className="text-sm">一部のフォルダにアクセスできないため、移動対象を検出できていない可能性があります。フォルダのアクセス権を確認してから更新してください。</p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag long Chinese text (caseless script)", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <p>由于无法访问某些文件夹，可能无法检测到移动目标。请检查文件夹的访问权限，然后更新。</p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag long Korean text (caseless script)", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <p>일부 폴더에 액세스할 수 없으므로 이동 대상을 감지할 수 없습니다. 폴더 액세스 권한을 확인한 후 업데이트하십시오.</p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag long Arabic text (caseless script)", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <p>لا يمكن الوصول إلى بعض المجلدات، لذا قد لا يتم اكتشاف أهداف النقل. يرجى التحقق من أذونات الوصول إلى المجلد، ثم التحديث.</p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag mixed script text (English + Japanese) without uppercase", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <p>Please check フォルダのアクセス権を確認してから更新してください your folder permissions before continuing.</p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags mixed script text when English portion is all caps", () => {
    const result = runRule(
      noAllCapsBodyText,
      `const Example = () => <p>PLEASE CHECK フォルダのアクセス権を確認してから更新してください YOUR FOLDER PERMISSIONS.</p>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
