import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeConditionallyExecuted } from "../../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isInsideRepeatedExecution } from "./is-inside-repeated-execution.js";
import { resolveThreeConstructor } from "./resolve-three-constructor.js";

export const getStaticThreeMeshVisibility = (
  expression: EsTreeNode,
  context: RuleContext,
): boolean | null => {
  const constructor = resolveThreeConstructor(expression, context.scopes);
  if (constructor?.constructorName !== "Mesh") return null;
  const allocationRoot = findTransparentExpressionRoot(expression);
  const declarator = allocationRoot.parent;
  const meshKey =
    isNodeOfType(declarator, "VariableDeclarator") &&
    declarator.init === allocationRoot &&
    isNodeOfType(declarator.id, "Identifier")
      ? resolveExpressionKey(declarator.id, context)
      : resolveExpressionKey(expression, context);
  if (!meshKey) {
    const parent = allocationRoot.parent;
    if (isNodeOfType(parent, "ExpressionStatement")) return true;
    if (
      !isNodeOfType(parent, "CallExpression") ||
      !isNodeOfType(parent.callee, "MemberExpression") ||
      getStaticPropertyName(parent.callee) !== "add" ||
      resolveThreeConstructor(parent.callee.object, context.scopes)?.constructorName !== "Scene"
    ) {
      return null;
    }
    return true;
  }
  const program = findProgramRoot(expression);
  if (!program) return null;
  const owner = context.cfg.enclosingFunction(expression) ?? program;
  let isVisible = true;
  let isComplete = true;
  walkAst(program, (node) => {
    if (!isComplete) return;
    if (isNodeOfType(node, "CallExpression")) {
      const receiverKey = isNodeOfType(node.callee, "MemberExpression")
        ? resolveExpressionKey(node.callee.object, context)
        : null;
      const passesMesh = node.arguments.some(
        (argument) =>
          !isNodeOfType(argument, "SpreadElement") &&
          resolveExpressionKey(argument, context) === meshKey,
      );
      if (receiverKey === meshKey) {
        isComplete = false;
        return;
      }
      if (!passesMesh) return;
      const isSceneAdd =
        isNodeOfType(node.callee, "MemberExpression") &&
        getStaticPropertyName(node.callee) === "add" &&
        resolveThreeConstructor(node.callee.object, context.scopes)?.constructorName === "Scene";
      if (!isSceneAdd) isComplete = false;
      return;
    }
    if (!isNodeOfType(node, "AssignmentExpression") || node.operator !== "=") return;
    const target = stripParenExpression(node.left);
    if (isNodeOfType(target, "Identifier") && resolveExpressionKey(target, context) === meshKey) {
      isComplete = false;
      return;
    }
    if (
      !isNodeOfType(target, "MemberExpression") ||
      resolveExpressionKey(target.object, context) !== meshKey ||
      getStaticPropertyName(target) !== "visible"
    ) {
      return;
    }
    if (
      (context.cfg.enclosingFunction(node) ?? program) !== owner ||
      isNodeConditionallyExecuted(node, owner) ||
      isInsideRepeatedExecution(node)
    ) {
      isComplete = false;
      return;
    }
    const staticVisibility = readStaticBoolean(node.right);
    if (staticVisibility === null) isComplete = false;
    else isVisible = staticVisibility;
  });
  if (!isComplete) return null;
  return isVisible;
};
