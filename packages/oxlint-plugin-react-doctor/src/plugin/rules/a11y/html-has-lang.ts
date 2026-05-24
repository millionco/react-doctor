import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE = "`<html>` element must have a non-empty `lang` attribute.";

interface HtmlHasLangSettings {
  htmlTags?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<HtmlHasLangSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { htmlHasLang?: HtmlHasLangSettings }).htmlHasLang ?? {})
      : {};
  return { htmlTags: ruleSettings.htmlTags ?? ["html"] };
};

// Evaluate a JSX attribute value to a "valid lang" verdict:
//   "ok"      — non-empty static value, or a non-static expression
//                (which we conservatively assume is dynamic and OK)
//   "missing" — no value at all
//   "empty"   — value is statically empty / falsy
type LangVerdict = "ok" | "missing" | "empty";

const evaluateLang = (attributeValue: EsTreeNode | null | undefined): LangVerdict => {
  if (!attributeValue) return "ok"; // bare attr <html lang /> — OXC accepts
  if (isNodeOfType(attributeValue, "Literal")) {
    if (typeof attributeValue.value === "string") {
      return attributeValue.value.trim().length > 0 ? "ok" : "empty";
    }
    if (attributeValue.value === null) return "empty";
    return attributeValue.value === false || attributeValue.value === 0 ? "empty" : "ok";
  }
  if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
    const expression = attributeValue.expression;
    if (isNodeOfType(expression, "Literal")) {
      if (typeof expression.value === "string") {
        return expression.value.trim().length > 0 ? "ok" : "empty";
      }
      // Anything else (number / boolean / null / regex) isn't a valid
      // language tag — flag.
      return "empty";
    }
    if (isNodeOfType(expression, "Identifier")) {
      if (expression.name === "undefined") return "empty";
      return "ok"; // dynamic identifier, assume valid
    }
    if (isNodeOfType(expression, "TemplateLiteral")) {
      const staticValue = getStaticTemplateLiteralValue(expression);
      return staticValue === null ? "ok" : staticValue.length > 0 ? "ok" : "empty";
    }
    return "ok";
  }
  return "ok";
};

// Port of `oxc_linter::rules::jsx_a11y::html_has_lang`. Reports
// `<html>` (or configured aliases) without a lang attribute, OR with
// a statically-empty / falsy value. Spread attributes count as
// "missing lang".
export const htmlHasLang = defineRule<Rule>({
  id: "html-has-lang",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    'Set `<html lang="…">` so assistive technology can announce the document language.',
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const tagSet = new Set(settings.htmlTags);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const tag = getElementType(node, context.settings);
        if (!tagSet.has(tag)) return;
        // <html {...props} /> — can't verify lang; flag.
        const hasSpread = node.attributes.some((attribute) =>
          isNodeOfType(attribute as EsTreeNode, "JSXSpreadAttribute"),
        );
        const lang = hasJsxPropIgnoreCase(node.attributes, "lang");
        if (!lang) {
          context.report({ node: node.name, message: MESSAGE });
          return;
        }
        const verdict = evaluateLang(lang.value as EsTreeNode | null | undefined);
        if (verdict === "missing" || verdict === "empty") {
          context.report({ node: lang, message: MESSAGE });
          return;
        }
        // Spread attribute counts as missing only when there's no
        // valid lang value either.
        if (hasSpread && !lang) {
          context.report({ node: node.name, message: MESSAGE });
        }
      },
    };
  },
});
