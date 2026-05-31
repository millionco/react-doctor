import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Screen reader users can lose their shortcuts because `accessKey` clashes with them, so remove it.";

// True iff the expression is the literal `undefined` identifier.
const isUndefinedIdentifier = (expression: EsTreeNode): boolean =>
  isNodeOfType(expression, "Identifier") && expression.name === "undefined";

// Port of `oxc_linter::rules::jsx_a11y::no_access_key`. Flags any
// `accessKey` attribute UNLESS its value is the bare `undefined`
// identifier (matching OXC's `is_undefined` carve-out).
export const noAccessKey = defineRule<Rule>({
  id: "no-access-key",
  title: "accessKey attribute used",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Do not use `accessKey`. It conflicts with assistive tech shortcuts.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const accessKey = hasJsxPropIgnoreCase(node.attributes, "accessKey");
      if (!accessKey) return;
      const attributeValue = accessKey.value as EsTreeNode | null;
      // No value → bare `accessKey` attribute. OXC's tests don't
      // include this case; we conservatively don't flag.
      if (!attributeValue) return;
      if (isNodeOfType(attributeValue, "Literal") && typeof attributeValue.value === "string") {
        context.report({ node: accessKey, message: MESSAGE });
        return;
      }
      if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
        const expression = attributeValue.expression;
        if (!expression || expression.type === "JSXEmptyExpression") return;
        if (isUndefinedIdentifier(expression as EsTreeNode)) return;
        context.report({ node: accessKey, message: MESSAGE });
      }
    },
  }),
});
