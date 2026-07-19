import { collectContextBindings } from "../../utils/collect-context-bindings.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isContextProviderJsxName } from "../../utils/is-context-provider-jsx-name.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "Every reader of this context redraws on each render because you build its `value` inline.";

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

// Port of `oxc_linter::rules::react::jsx_no_constructed_context_values`.
// Reports `<XContext.Provider value={…}>` AND the React 19 shorthand
// `<XContext value={…}>` where the `value` is constructed per-render
// (object/array/function/JSX/etc.) AND the provider sits inside a
// function (i.e. a render).
//
// The React 19 shorthand is detected by collecting file-local
// `const X = createContext(...)` bindings on Program visit, then
// checking whether the JSX opening name is one of those bindings.
// Covers createContext imported from `react`, `use-context-selector`,
// and `react-tracked`.
export const jsxNoConstructedContextValues = defineRule({
  id: "jsx-no-constructed-context-values",
  title: "Unstable context provider value",
  tags: ["react-jsx-only"],
  severity: "warn",
  disabledWhen: ["react-compiler"],
  recommendation:
    "Wrap the context value in `useMemo` or move it outside the component so consumers do not redraw every render.",
  category: "Performance",
  create: (context) => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    let contextBindings: ReadonlySet<number> = new Set<number>();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        contextBindings = collectContextBindings(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (isTestlikeFile) return;
        if (!isContextProviderJsxName(node.name, contextBindings, context.scopes)) return;
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
