import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: detect static JSX declared inside a component body — anything like
// `const Header = <h1>Hi</h1>` inside a render function gets recreated on
// every render. If the JSX has no expression containers referencing local
// scope (no props, no state), it can be hoisted to module scope.
const jsxReferencesLocalScope = (jsxNode: EsTreeNode): boolean => {
  let referencesScope = false;
  walkAst(jsxNode, (child: EsTreeNode) => {
    if (referencesScope) return;
    if (
      isNodeOfType(child, "JSXExpressionContainer") &&
      !isNodeOfType(child.expression, "JSXEmptyExpression")
    ) {
      referencesScope = true;
    }
    if (isNodeOfType(child, "JSXSpreadAttribute")) {
      referencesScope = true;
    }
  });
  return referencesScope;
};

export const renderingHoistJsx = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Move the static JSX to module scope: `const ICON = <svg>...</svg>` outside the component so it isn't recreated each render",
  examples: [
    {
      before:
        "function Card() {\n  const ICON = <svg><path d='M0 0h10v10H0z' /></svg>;\n  return <div>{ICON}</div>;\n}",
      after:
        "const ICON = <svg><path d='M0 0h10v10H0z' /></svg>;\nfunction Card() {\n  return <div>{ICON}</div>;\n}",
    },
  ],
  create: (context: RuleContext) => {
    let componentDepth = 0;

    const isComponentLike = (node: EsTreeNode): boolean => {
      if (
        isNodeOfType(node, "FunctionDeclaration") &&
        node.id?.name &&
        isUppercaseName(node.id.name)
      ) {
        return true;
      }
      if (isNodeOfType(node, "VariableDeclarator") && isComponentAssignment(node)) {
        return true;
      }
      return false;
    };

    const enter = (node: EsTreeNode): void => {
      if (isComponentLike(node)) componentDepth++;
    };
    const exit = (node: EsTreeNode): void => {
      if (isComponentLike(node)) componentDepth = Math.max(0, componentDepth - 1);
    };

    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      VariableDeclarator: enter,
      "VariableDeclarator:exit": exit,
      VariableDeclaration(node: EsTreeNodeOfType<"VariableDeclaration">) {
        if (componentDepth === 0) return;
        if (node.kind !== "const") return;
        for (const declarator of node.declarations ?? []) {
          const init = declarator.init;
          if (!init) continue;
          if (!isNodeOfType(init, "JSXElement") && !isNodeOfType(init, "JSXFragment")) continue;
          if (jsxReferencesLocalScope(init)) continue;
          const name = isNodeOfType(declarator.id, "Identifier") ? declarator.id.name : "<unnamed>";
          context.report({
            node: declarator,
            message: `Static JSX "${name}" inside a component — hoist to module scope so it isn't recreated each render`,
          });
        }
      },
    };
  },
});
