import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Context `value` prop is constructed inline — wrap with `useMemo`/`useCallback` or hoist a constant to avoid re-renders.";

const isConstructedValue = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (
    isNodeOfType(stripped, "ObjectExpression") ||
    isNodeOfType(stripped, "ArrayExpression") ||
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression") ||
    isNodeOfType(stripped, "ClassExpression") ||
    isNodeOfType(stripped, "NewExpression") ||
    isNodeOfType(stripped, "JSXElement") ||
    isNodeOfType(stripped, "JSXFragment")
  ) {
    return true;
  }
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return isConstructedValue(stripped.consequent) || isConstructedValue(stripped.alternate);
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return isConstructedValue(stripped.left) || isConstructedValue(stripped.right);
  }
  return false;
};

const isProviderName = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "JSXMemberExpression")) return false;
  return node.property.name === "Provider";
};

// Port of `oxc_linter::rules::react::jsx_no_constructed_context_values`.
// Reports `<XContext.Provider value={…}>` where the `value` is
// constructed per-render (object/array/function/JSX/etc.) AND the
// provider sits inside a function (i.e. a render). LIMITATION: OXC
// additionally tracks `createContext` return assignments and identifies
// providers via that route — we limit detection to the
// `<X.Provider …>` shape, which covers the common cases.
export const jsxNoConstructedContextValues = defineRule<Rule>({
  id: "jsx-no-constructed-context-values",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Memoize the context value (`useMemo`) or hoist it outside the render.",
  category: "Performance",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        if (!isProviderName(node.name as EsTreeNode)) return;
        if (!isInsideFunctionScope(node)) return;
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
          if (attribute.name.name !== "value") continue;
          const attributeValue = attribute.value;
          if (!attributeValue) continue;
          if (!isNodeOfType(attributeValue, "JSXExpressionContainer")) continue;
          const innerExpression = attributeValue.expression;
          if (!innerExpression || innerExpression.type === "JSXEmptyExpression") continue;
          if (!isConstructedValue(innerExpression as EsTreeNode)) continue;
          context.report({ node: attribute, message: MESSAGE });
        }
      },
    };
  },
});
