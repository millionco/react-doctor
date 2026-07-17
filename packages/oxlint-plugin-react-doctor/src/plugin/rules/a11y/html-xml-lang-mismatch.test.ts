import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { htmlXmlLangMismatch } from "./html-xml-lang-mismatch.js";

describe("html-xml-lang-mismatch", () => {
  it("reports different static base languages", () => {
    const result = runRule(
      htmlXmlLangMismatch,
      `const Page = () => <html lang="en-US" xml:lang="fr-CA" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts matching base languages and dynamic declarations", () => {
    const result = runRule(
      htmlXmlLangMismatch,
      `const Page = ({ locale }) => <><html lang="en-US" xml:lang="en-GB" /><html lang={locale} xml:lang="fr" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
