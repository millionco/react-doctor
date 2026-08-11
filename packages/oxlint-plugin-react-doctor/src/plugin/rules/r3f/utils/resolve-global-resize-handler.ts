import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const isGlobalWindow = (node: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(node);
  return Boolean(
    isNodeOfType(candidate, "Identifier") &&
    candidate.name === "window" &&
    context.scopes.isGlobalReference(candidate),
  );
};

const getResizeHandlerExpression = (node: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  if (isNodeOfType(node, "CallExpression")) {
    const callee = stripParenExpression(node.callee);
    const eventName = node.arguments[0];
    const handler = node.arguments[1];
    if (
      isNodeOfType(callee, "MemberExpression") &&
      getStaticPropertyName(callee) === "addEventListener" &&
      isGlobalWindow(callee.object, context) &&
      isNodeOfType(eventName, "Literal") &&
      eventName.value === "resize" &&
      handler &&
      !isNodeOfType(handler, "SpreadElement")
    ) {
      return handler;
    }
  }
  if (isNodeOfType(node, "AssignmentExpression") && node.operator === "=") {
    const target = stripParenExpression(node.left);
    if (
      isNodeOfType(target, "MemberExpression") &&
      getStaticPropertyName(target) === "onresize" &&
      isGlobalWindow(target.object, context)
    ) {
      return node.right;
    }
  }
  if (isNodeOfType(node, "NewExpression")) {
    const constructor = stripParenExpression(node.callee);
    const handler = node.arguments[0];
    if (
      isNodeOfType(constructor, "Identifier") &&
      constructor.name === "ResizeObserver" &&
      context.scopes.isGlobalReference(constructor) &&
      handler &&
      !isNodeOfType(handler, "SpreadElement")
    ) {
      return handler;
    }
  }
  return null;
};

export const resolveGlobalResizeHandler = (
  node: EsTreeNodeOfType<"AssignmentExpression" | "CallExpression" | "NewExpression">,
  context: RuleContext,
): EsTreeNode | null => {
  const handler = getResizeHandlerExpression(node, context);
  return handler ? resolveExactLocalFunction(handler, context.scopes) : null;
};
