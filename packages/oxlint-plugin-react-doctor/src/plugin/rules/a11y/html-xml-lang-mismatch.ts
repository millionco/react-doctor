import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const getBaseLanguage = (value: string): string => value.trim().toLowerCase().split("-")[0] ?? "";

export const htmlXmlLangMismatch = defineRule({
  id: "html-xml-lang-mismatch",
  title: "Conflicting document language declarations",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation: "Use matching base languages for lang and xml:lang on the root html element.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveJsxElementType(node) !== "html") return;
      const languageAttribute = getAuthoritativeJsxAttribute(node.attributes, "lang", false);
      const xmlLanguageAttribute = getAuthoritativeJsxAttribute(node.attributes, "xml:lang", false);
      if (!languageAttribute || !xmlLanguageAttribute) return;
      const language = getStringLiteralAttributeValue(languageAttribute);
      const xmlLanguage = getStringLiteralAttributeValue(xmlLanguageAttribute);
      if (language === null || xmlLanguage === null) return;
      const baseLanguage = getBaseLanguage(language);
      const baseXmlLanguage = getBaseLanguage(xmlLanguage);
      if (!baseLanguage || !baseXmlLanguage || baseLanguage === baseXmlLanguage) return;
      context.report({
        node: xmlLanguageAttribute,
        message: `lang declares ${baseLanguage}, but xml:lang declares ${baseXmlLanguage}. Use the same base language so assistive technology chooses one pronunciation model.`,
      });
    },
  }),
});
