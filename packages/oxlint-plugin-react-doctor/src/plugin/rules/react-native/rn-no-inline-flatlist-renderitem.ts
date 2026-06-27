import { REACT_NATIVE_LIST_COMPONENTS } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnNoInlineFlatlistRenderitem = defineRule({
  id: "rn-no-inline-flatlist-renderitem",
  title: "Inline renderItem on list",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  // React Compiler auto-memoizes inline functions/objects in list rows, so the
  // perf footgun this rule guards against doesn't exist in compiler-enabled
  // projects (#723).
  disabledWhen: ["react-compiler"],
  recommendation:
    "Move renderItem to a named function or wrap it in useCallback so it is not rebuilt every time the screen redraws.",
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
        message: `Your users see extra row work when renderItem on <${listComponentName}> is rebuilt every time the screen redraws.`,
      });
    },
  }),
});
