import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { resolveReactRefSymbol } from "../../../utils/react-ref-origin.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { THREE_REF_VECTOR_PROPERTIES } from "./constants.js";
import { isClosedThreeGroupRef } from "./is-closed-three-group-ref.js";

export const isKnownThreeRefRenderMutation = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const method = stripParenExpression(call.callee);
  if (
    call.optional ||
    !isNodeOfType(method, "MemberExpression") ||
    method.computed ||
    method.optional ||
    !isNodeOfType(method.property, "Identifier") ||
    method.property.name !== "set"
  )
    return false;
  const vector = stripParenExpression(method.object);
  if (
    !isNodeOfType(vector, "MemberExpression") ||
    vector.computed ||
    vector.optional ||
    !isNodeOfType(vector.property, "Identifier") ||
    !THREE_REF_VECTOR_PROPERTIES.has(vector.property.name)
  )
    return false;
  const current = stripParenExpression(vector.object);
  const ref = resolveReactRefSymbol(current, context.scopes);
  if (!ref) return false;
  const statement = findTransparentExpressionRoot(call).parent;
  const owner = findRenderPhaseComponentOrHook(call, context.scopes);
  return Boolean(
    owner &&
    isFunctionLike(owner) &&
    findEnclosingFunction(call) === owner &&
    isNodeOfType(statement, "ExpressionStatement") &&
    statement.parent === owner.body &&
    isNodeReachableWithinFunction(call, context) &&
    isClosedThreeGroupRef(ref, owner, context),
  );
};
