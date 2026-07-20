import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { componentRendersInk } from "../../utils/component-renders-ink.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const hasIncrementExpression = (updaterNode: EsTreeNode): boolean => {
  if (
    !isNodeOfType(updaterNode, "ArrowFunctionExpression") &&
    !isNodeOfType(updaterNode, "FunctionExpression")
  ) {
    return false;
  }
  const returnedExpressions = isNodeOfType(updaterNode.body, "BlockStatement")
    ? collectFunctionReturnStatements(updaterNode).flatMap((returnStatement) =>
        returnStatement.argument ? [returnStatement.argument] : [],
      )
    : [updaterNode.body];
  return returnedExpressions.some((returnedExpression) => {
    const unwrappedExpression = stripParenExpression(returnedExpression);
    return (
      isNodeOfType(unwrappedExpression, "BinaryExpression") &&
      ["+", "-", "%"].includes(unwrappedExpression.operator)
    );
  });
};

const isFrameIncrement = (callbackNode: EsTreeNode): boolean => {
  let hasFrameIncrement = false;
  walkAst(callbackNode, (descendantNode) => {
    if (descendantNode !== callbackNode && /Function/.test(descendantNode.type)) return false;
    if (
      !isNodeOfType(descendantNode, "CallExpression") ||
      !isNodeOfType(descendantNode.callee, "Identifier") ||
      descendantNode.callee.name !== "setFrame"
    ) {
      return;
    }
    const updaterNode = descendantNode.arguments[0];
    if (updaterNode && hasIncrementExpression(updaterNode)) {
      hasFrameIncrement = true;
    }
  });
  return hasFrameIncrement;
};

export const inkPreferUseAnimation = defineRule({
  id: "ink-prefer-use-animation",
  title: "Animation loop implemented with setInterval",
  category: "Performance",
  severity: "warn",
  minimumInkVersion: MINIMUM_INK_VERSIONS.modernHooks,
  recommendation: "Use Ink's shared `useAnimation()` scheduler and automatic unmount cleanup.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "setInterval") return;
      if (!context.scopes.isGlobalReference(node.callee)) return;
      let ancestorNode: EsTreeNode | null | undefined = node.parent;
      let effectCall: EsTreeNodeOfType<"CallExpression"> | null = null;
      while (ancestorNode) {
        if (
          isNodeOfType(ancestorNode, "CallExpression") &&
          isNodeOfType(ancestorNode.callee, "Identifier") &&
          context.scopes.symbolFor(ancestorNode.callee)?.kind === "import" &&
          ["useEffect", "useLayoutEffect"].includes(
            getImportedNameFromModule(ancestorNode, ancestorNode.callee.name, "react") ?? "",
          )
        ) {
          effectCall = ancestorNode;
          break;
        }
        ancestorNode = ancestorNode.parent;
      }
      const intervalCallback = node.arguments[0];
      if (!effectCall || !intervalCallback || !isFrameIncrement(intervalCallback)) return;
      const componentNode = findRenderPhaseComponentOrHook(effectCall, context.scopes);
      if (!componentNode || !componentRendersInk(componentNode, context.scopes)) return;
      context.report({
        node,
        message: "This frame-counter interval is an Ink animation; prefer `useAnimation()`.",
      });
    },
  }),
});
