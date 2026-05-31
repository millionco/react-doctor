import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Screen readers can't pick the right voice because this `lang` isn't a real language code, so use a valid one like `en` or `en-US`.";

// Common ISO-639 primary tags (very partial — full validation requires
// the IANA registry). When the value isn't recognized, we still allow
// patterns that LOOK like a tag (lowercase letters + optional region
// suffix).
const COMMON_LANGUAGE_PRIMARY_TAGS: ReadonlySet<string> = new Set([
  "aa",
  "ab",
  "ae",
  "af",
  "ak",
  "am",
  "an",
  "ar",
  "as",
  "av",
  "ay",
  "az",
  "ba",
  "be",
  "bg",
  "bh",
  "bi",
  "bm",
  "bn",
  "bo",
  "br",
  "bs",
  "ca",
  "ce",
  "ch",
  "co",
  "cr",
  "cs",
  "cu",
  "cv",
  "cy",
  "da",
  "de",
  "dv",
  "dz",
  "ee",
  "el",
  "en",
  "eo",
  "es",
  "et",
  "eu",
  "fa",
  "ff",
  "fi",
  "fj",
  "fo",
  "fr",
  "fy",
  "ga",
  "gd",
  "gl",
  "gn",
  "gu",
  "gv",
  "ha",
  "he",
  "hi",
  "ho",
  "hr",
  "ht",
  "hu",
  "hy",
  "hz",
  "ia",
  "id",
  "ie",
  "ig",
  "ii",
  "ik",
  "io",
  "is",
  "it",
  "iu",
  "ja",
  "jv",
  "ka",
  "kg",
  "ki",
  "kj",
  "kk",
  "kl",
  "km",
  "kn",
  "ko",
  "kr",
  "ks",
  "ku",
  "kv",
  "kw",
  "ky",
  "la",
  "lb",
  "lg",
  "li",
  "ln",
  "lo",
  "lt",
  "lu",
  "lv",
  "mg",
  "mh",
  "mi",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "na",
  "nb",
  "nd",
  "ne",
  "ng",
  "nl",
  "nn",
  "no",
  "nr",
  "nv",
  "ny",
  "oc",
  "oj",
  "om",
  "or",
  "os",
  "pa",
  "pi",
  "pl",
  "ps",
  "pt",
  "qu",
  "rm",
  "rn",
  "ro",
  "ru",
  "rw",
  "sa",
  "sc",
  "sd",
  "se",
  "sg",
  "si",
  "sk",
  "sl",
  "sm",
  "sn",
  "so",
  "sq",
  "sr",
  "ss",
  "st",
  "su",
  "sv",
  "sw",
  "ta",
  "te",
  "tg",
  "th",
  "ti",
  "tk",
  "tl",
  "tn",
  "to",
  "tr",
  "ts",
  "tt",
  "tw",
  "ty",
  "ug",
  "uk",
  "ur",
  "uz",
  "ve",
  "vi",
  "vo",
  "wa",
  "wo",
  "xh",
  "yi",
  "yo",
  "za",
  "zh",
  "zu",
]);

const isValidLangTag = (value: string): boolean => {
  if (value.length === 0) return false;
  // BCP-47 shape: primary[-script][-region][...]
  const parts = value.split(/[-_]/);
  if (parts.length === 0) return false;
  const primary = parts[0]!.toLowerCase();
  if (!COMMON_LANGUAGE_PRIMARY_TAGS.has(primary)) return false;
  // Subtags should be alphanumeric.
  return parts.every((part) => /^[A-Za-z0-9]+$/.test(part));
};

// Port of `oxc_linter::rules::jsx_a11y::lang`. Validates `lang`
// attribute on `<html>` and similar elements.
export const lang = defineRule<Rule>({
  id: "lang",
  title: "Invalid lang attribute value",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Use a valid language code, like `en` or `en-US`.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tag = getElementType(node, context.settings);
      if (tag !== "html") return;
      const langAttr = hasJsxPropIgnoreCase(node.attributes, "lang");
      if (!langAttr) return;
      const attributeValue = langAttr.value;
      if (attributeValue && attributeValue.type === "JSXExpressionContainer") {
        const expression = (
          attributeValue as { expression: { type?: string; name?: string; value?: unknown } }
        ).expression;
        // lang={undefined} / lang={null} are explicit invalid values.
        if (
          (expression.type === "Identifier" && expression.name === "undefined") ||
          (expression.type === "Literal" && expression.value === null)
        ) {
          context.report({ node: langAttr, message: MESSAGE });
          return;
        }
      }
      const value = getJsxPropStringValue(langAttr);
      if (value === null) return;
      if (!isValidLangTag(value)) {
        context.report({ node: langAttr, message: MESSAGE });
      }
    },
  }),
});
