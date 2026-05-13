import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isMemoCall = (node: EsTreeNode): boolean => {
  if (node.type !== "CallExpression") return false;
  if (node.callee?.type === "Identifier" && node.callee.name === "memo") return true;
  if (
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "React" &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === "memo"
  )
    return true;
  return false;
};

const isInlineReference = (node: EsTreeNode): string | null => {
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    (node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.property?.name === "bind")
  )
    return "functions";

  if (node.type === "ObjectExpression") return "objects";
  if (node.type === "ArrayExpression") return "Arrays";
  if (node.type === "JSXElement" || node.type === "JSXFragment") return "JSX";

  return null;
};

export const noInlinePropOnMemoComponent = defineRule<Rule>({
  recommendation:
    "Hoist the inline `() => ...` / `[]` / `{}` to a stable reference (useMemo, useCallback, or module scope) so the memoized child doesn't re-render every parent render",
  create: (context: RuleContext) => {
    const memoizedComponentNames = new Set<string>();

    return {
      VariableDeclarator(node: EsTreeNode) {
        if (node.id?.type !== "Identifier" || !node.init) return;
        if (isMemoCall(node.init)) {
          memoizedComponentNames.add(node.id.name);
        }
      },
      ExportDefaultDeclaration(node: EsTreeNode) {
        if (node.declaration && isMemoCall(node.declaration)) {
          const innerArgument = node.declaration.arguments?.[0];
          if (innerArgument?.type === "Identifier") {
            memoizedComponentNames.add(innerArgument.name);
          }
        }
      },
      JSXAttribute(node: EsTreeNode) {
        if (!node.value || node.value.type !== "JSXExpressionContainer") return;

        const openingElement = node.parent;
        if (!openingElement || openingElement.type !== "JSXOpeningElement") return;

        let elementName: string | null = null;
        if (openingElement.name?.type === "JSXIdentifier") {
          elementName = openingElement.name.name;
        }
        if (!elementName || !memoizedComponentNames.has(elementName)) return;

        const propType = isInlineReference(node.value.expression);
        if (propType) {
          context.report({
            node: node.value.expression,
            message: `JSX attribute values should not contain ${propType} created in the same scope — ${elementName} is wrapped in memo(), so new references cause unnecessary re-renders`,
          });
        }
      },
    };
  },
});
