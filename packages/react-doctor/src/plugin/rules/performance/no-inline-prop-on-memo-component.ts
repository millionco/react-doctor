import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isMemoCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "memo") return true;
  if (
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    node.callee.object.name === "React" &&
    isNodeOfType(node.callee.property, "Identifier") &&
    node.callee.property.name === "memo"
  )
    return true;
  return false;
};

const isInlineReference = (node: EsTreeNode): string | null => {
  if (
    isNodeOfType(node, "ArrowFunctionExpression") ||
    isNodeOfType(node, "FunctionExpression") ||
    (isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "bind")
  )
    return "functions";

  if (isNodeOfType(node, "ObjectExpression")) return "objects";
  if (isNodeOfType(node, "ArrayExpression")) return "Arrays";
  if (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")) return "JSX";

  return null;
};

export const noInlinePropOnMemoComponent = defineRule<Rule>({
  id: "no-inline-prop-on-memo-component",
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Hoist the inline `() => ...` / `[]` / `{}` to a stable reference (useMemo, useCallback, or module scope) so the memoized child doesn't re-render every parent render",
  examples: [
    {
      before: "const Row = memo(RowImpl);\nreturn <Row onSelect={() => doThing()} items={[]} />;",
      after:
        "const Row = memo(RowImpl);\nconst onSelect = useCallback(() => doThing(), []);\nconst items = useMemo(() => [], []);\nreturn <Row onSelect={onSelect} items={items} />;",
    },
  ],
  create: (context: RuleContext) => {
    const memoizedComponentNames = new Set<string>();

    return {
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier") || !node.init) return;
        if (isMemoCall(node.init)) {
          memoizedComponentNames.add(node.id.name);
        }
      },
      ExportDefaultDeclaration(node: EsTreeNodeOfType<"ExportDefaultDeclaration">) {
        if (
          node.declaration &&
          isNodeOfType(node.declaration, "CallExpression") &&
          isMemoCall(node.declaration)
        ) {
          const innerArgument = node.declaration.arguments?.[0];
          if (isNodeOfType(innerArgument, "Identifier")) {
            memoizedComponentNames.add(innerArgument.name);
          }
        }
      },
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;

        const openingElement = node.parent;
        if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return;

        let elementName: string | null = null;
        if (isNodeOfType(openingElement.name, "JSXIdentifier")) {
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
