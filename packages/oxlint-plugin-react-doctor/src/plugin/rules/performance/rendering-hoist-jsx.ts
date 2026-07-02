import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: detect static JSX declared inside a component body — anything like
// `const Header = <h1>Hi</h1>` inside a render function gets recreated on
// every render. If the JSX has no expression containers referencing local
// scope (no props, no state), it can be hoisted to module scope.
const jsxReferencesLocalScope = (jsxNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
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
    // `<Empty />` where `Empty` is declared inside the component (not a
    // module/import binding) can't be hoisted — it captures a render-local
    // value. The scope analyzer only records a JSX identifier reference
    // for a capitalized opening-element name or a member-expression root,
    // so resolving any such reference to a non-module binding flags it.
    if (isNodeOfType(child, "JSXIdentifier")) {
      const resolvedSymbol = scopes.referenceFor(child)?.resolvedSymbol;
      if (
        resolvedSymbol &&
        resolvedSymbol.kind !== "import" &&
        resolvedSymbol.scope.kind !== "module"
      ) {
        referencesScope = true;
      }
    }
  });
  return referencesScope;
};

export const renderingHoistJsx = defineRule({
  id: "rendering-hoist-jsx",
  title: "Constant JSX rebuilt each render",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move the static JSX out to the top of the file: `const ICON = <svg>...</svg>`, so it isn't rebuilt on every render",
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
          if (jsxReferencesLocalScope(init, context.scopes)) continue;
          const name = isNodeOfType(declarator.id, "Identifier") ? declarator.id.name : "<unnamed>";
          context.report({
            node: declarator,
            message: `This rebuilds on every render because static JSX "${name}" is built inside the component, so move it to the top of the file to make it just once`,
          });
        }
      },
    };
  },
});
