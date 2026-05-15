import { REACT_NATIVE_LIST_COMPONENTS } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnNoInlineFlatlistRenderitem = defineRule<Rule>({
  id: "rn-no-inline-flatlist-renderitem",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Extract renderItem to a named function or wrap in useCallback to avoid re-creating on every render",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "renderItem") return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const openingElement = node.parent;
      if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return;

      const listComponentName = resolveJsxElementName(openingElement);
      if (!listComponentName || !REACT_NATIVE_LIST_COMPONENTS.has(listComponentName)) return;

      const expression = node.value.expression;
      if (
        !isNodeOfType(expression, "ArrowFunctionExpression") &&
        !isNodeOfType(expression, "FunctionExpression")
      )
        return;

      context.report({
        node: expression,
        message: `Inline renderItem on <${listComponentName}> creates a new function reference every render — extract to a named function or wrap in useCallback`,
      });
    },
  }),
});
