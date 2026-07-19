import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
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
    if (
      !isNodeOfType(descendantNode, "CallExpression") ||
      !isNodeOfType(descendantNode.callee, "Identifier") ||
      !/^set(?:Frame|Index|Step|Tick)/.test(descendantNode.callee.name)
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
      const effectFunction = node.parent;
      let ancestorNode: EsTreeNode | null | undefined = effectFunction;
      let isInsideReactEffect = false;
      while (ancestorNode) {
        if (
          isNodeOfType(ancestorNode, "CallExpression") &&
          isNodeOfType(ancestorNode.callee, "Identifier") &&
          context.scopes.symbolFor(ancestorNode.callee)?.kind === "import" &&
          ["useEffect", "useLayoutEffect"].includes(
            getImportedNameFromModule(ancestorNode, ancestorNode.callee.name, "react") ?? "",
          )
        ) {
          isInsideReactEffect = true;
          break;
        }
        ancestorNode = ancestorNode.parent;
      }
      const intervalCallback = node.arguments[0];
      if (!isInsideReactEffect || !intervalCallback || !isFrameIncrement(intervalCallback)) return;
      context.report({
        node,
        message: "This frame-counter interval is an Ink animation; prefer `useAnimation()`.",
      });
    },
  }),
});
