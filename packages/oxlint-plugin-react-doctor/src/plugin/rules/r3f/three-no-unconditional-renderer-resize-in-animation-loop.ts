import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isThreeRendererReference } from "./utils/is-three-renderer-reference.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const THREE_RENDERER_RESIZE_METHOD_NAMES: ReadonlySet<string> = new Set([
  "setDrawingBufferSize",
  "setSize",
]);

const isDirectUnconditionalCallbackExpression = (
  node: EsTreeNode,
  callback: EsTreeNode,
): boolean => {
  const expressionRoot = findTransparentExpressionRoot(node);
  if (callback.type === "ArrowFunctionExpression" && callback.body === expressionRoot) return true;
  const statement = expressionRoot.parent;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.expression !== expressionRoot ||
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression") &&
      !isNodeOfType(callback, "FunctionDeclaration"))
  ) {
    return false;
  }
  if (!isNodeOfType(callback.body, "BlockStatement") || statement.parent !== callback.body) {
    return false;
  }
  const callbackStatements: ReadonlyArray<EsTreeNode> = callback.body.body;
  const statementIndex = callbackStatements.indexOf(statement);
  if (statementIndex < 0) return false;
  return callbackStatements
    .slice(0, statementIndex)
    .every(
      (previousStatement) =>
        isNodeOfType(previousStatement, "ExpressionStatement") ||
        isNodeOfType(previousStatement, "VariableDeclaration") ||
        isNodeOfType(previousStatement, "EmptyStatement"),
    );
};

export const threeNoUnconditionalRendererResizeInAnimationLoop = defineRule({
  id: "three-no-unconditional-renderer-resize-in-animation-loop",
  title: "Renderer resized unconditionally every frame",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Compare the drawing-buffer size first and resize the renderer only when its display size changed",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate) => {
          if (!isNodeOfType(candidate, "CallExpression")) return;
          const callee = stripParenExpression(candidate.callee);
          if (
            !isNodeOfType(callee, "MemberExpression") ||
            !THREE_RENDERER_RESIZE_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") ||
            !isThreeRendererReference(callee.object, context.scopes) ||
            context.cfg.enclosingFunction(candidate) !== callback ||
            !isDirectUnconditionalCallbackExpression(candidate, callback)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This animation callback resizes the renderer on every frame without checking whether the display size changed. Guard the resize with a drawing-buffer size comparison",
          });
        });
      },
    };
  },
});
