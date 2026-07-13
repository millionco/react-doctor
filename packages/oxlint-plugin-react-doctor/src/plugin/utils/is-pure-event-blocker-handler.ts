import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveMemberHandlerFunction } from "./resolve-member-handler-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// `<div onClick={(e) => e.stopPropagation()}>` is the canonical "block
// bubbling" idiom — the div isn't a user-interaction target, it just
// stops a click from reaching its parent. Adding role / keyboard
// handlers would be misleading (the div ISN'T a button), so a11y
// rules pass through pure event-blocker handlers.
const BLOCKER_METHOD_NAMES: ReadonlySet<string> = new Set([
  "stopPropagation",
  "preventDefault",
  "stopImmediatePropagation",
]);

const isEventBlockerCall = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  // `e?.stopPropagation()` parses as `ChainExpression(CallExpression(…))`;
  // unwrap so optional-chained blocker calls are recognised.
  const inner = isNodeOfType(node, "ChainExpression") ? (node.expression as EsTreeNode) : node;
  if (!isNodeOfType(inner, "CallExpression")) return false;
  const callee = inner.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return BLOCKER_METHOD_NAMES.has(callee.property.name);
};

const isPureEventBlockerBody = (body: EsTreeNode | null | undefined): boolean => {
  if (!body) return false;
  if (isEventBlockerCall(body)) return true;
  if (isNodeOfType(body, "BlockStatement")) {
    const statements = body.body ?? [];
    // Require at least one statement — empty `() => {}` is NOT a
    // blocker, it's a no-op that the rule should still flag.
    if (statements.length === 0) return false;
    for (const statement of statements) {
      if (!isNodeOfType(statement, "ExpressionStatement")) return false;
      if (!isEventBlockerCall(statement.expression as EsTreeNode)) return false;
    }
    return true;
  }
  return false;
};

export const isPureEventBlockerHandler = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    return false;
  }
  const expression = stripParenExpression(attribute.value.expression as EsTreeNode);
  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression")
  ) {
    return isPureEventBlockerBody(expression.body as EsTreeNode);
  }
  if (!isNodeOfType(expression, "MemberExpression")) return false;
  const resolvedHandler = resolveMemberHandlerFunction(expression);
  return isPureEventBlockerBody(resolvedHandler?.body);
};
