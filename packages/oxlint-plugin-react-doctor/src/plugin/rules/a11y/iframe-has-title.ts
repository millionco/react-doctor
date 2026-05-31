import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Blind users can't tell what this `<iframe>` holds because screen readers have no title to read, so add a `title` describing its content.";

type StaticVerdict = "ok" | "empty" | "dynamic-ok";

const evaluateTitleValue = (value: EsTreeNode | null | undefined): StaticVerdict | "missing" => {
  if (!value) return "missing";
  if (isNodeOfType(value, "Literal")) {
    if (typeof value.value === "string") {
      return value.value.trim().length > 0 ? "ok" : "empty";
    }
    return "empty";
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal")) {
      if (typeof expression.value === "string") {
        return expression.value.trim().length > 0 ? "ok" : "empty";
      }
      return "empty";
    }
    if (isNodeOfType(expression, "Identifier")) {
      if (expression.name === "undefined") return "empty";
      return "dynamic-ok";
    }
    if (isNodeOfType(expression, "TemplateLiteral")) {
      // Template with interpolation → dynamic OK; pure-string check
      // cooked content for emptiness.
      const staticValue = getStaticTemplateLiteralValue(expression);
      return staticValue === null ? "dynamic-ok" : staticValue.length > 0 ? "ok" : "empty";
    }
    return "dynamic-ok";
  }
  return "ok";
};

// Port of `oxc_linter::rules::jsx_a11y::iframe_has_title`.
export const iframeHasTitle = defineRule<Rule>({
  id: "iframe-has-title",
  title: "iframe missing title",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Add a descriptive `title` to every `<iframe>`.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tag = getElementType(node, context.settings);
      if (tag !== "iframe") return;
      // Spread attribute → can't statically verify; flag.
      const hasSpread = node.attributes.some((attribute) =>
        isNodeOfType(attribute as EsTreeNode, "JSXSpreadAttribute"),
      );
      const titleAttr = hasJsxPropIgnoreCase(node.attributes, "title");
      if (!titleAttr) {
        if (hasSpread || tag === "iframe") {
          context.report({ node: node.name, message: MESSAGE });
        }
        return;
      }
      const verdict = evaluateTitleValue(titleAttr.value as EsTreeNode | null | undefined);
      if (verdict === "missing" || verdict === "empty") {
        context.report({ node: titleAttr, message: MESSAGE });
      }
    },
  }),
});
