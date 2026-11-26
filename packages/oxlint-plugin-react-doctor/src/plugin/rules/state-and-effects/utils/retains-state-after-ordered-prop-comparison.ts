import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getNativeTimerCalleeName } from "../../../utils/get-native-timer-callee-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { EffectStateWriteFact } from "./collect-effect-state-write-facts.js";

const isBinding = (node: EsTreeNode, binding: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && scopes.symbolFor(node)?.id === binding.id;

const readComparedMember = (node: EsTreeNode, scopes: ScopeAnalysis) => {
  const member = stripParenExpression(node);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.object, "Identifier")
  )
    return null;
  const binding = scopes.symbolFor(member.object);
  const key = getStaticPropertyName(member);
  return binding && key !== null ? { id: binding.id, key } : null;
};

const isRetentionGuard = (
  test: EsTreeNode,
  incoming: SymbolDescriptor,
  stored: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(test);
  if (isNodeOfType(candidate, "LogicalExpression") && candidate.operator === "&&") {
    return (
      (readComparedMember(candidate.left, scopes)?.id === incoming.id &&
        isRetentionGuard(candidate.right, incoming, stored, scopes)) ||
      (readComparedMember(candidate.right, scopes)?.id === incoming.id &&
        isRetentionGuard(candidate.left, incoming, stored, scopes))
    );
  }
  if (!isNodeOfType(candidate, "LogicalExpression") || candidate.operator !== "||") return false;
  const absent = stripParenExpression(candidate.left);
  const order = stripParenExpression(candidate.right);
  if (
    !isNodeOfType(absent, "UnaryExpression") ||
    absent.operator !== "!" ||
    !isBinding(stripParenExpression(absent.argument), stored, scopes) ||
    !isNodeOfType(order, "BinaryExpression") ||
    !["<", "<=", ">", ">="].includes(order.operator)
  )
    return false;
  const left = readComparedMember(order.left, scopes);
  const right = readComparedMember(order.right, scopes);
  return Boolean(
    left &&
    right &&
    left.key === right.key &&
    ((left.id === incoming.id && right.id === stored.id) ||
      (left.id === stored.id && right.id === incoming.id)),
  );
};

const isPassiveStateUse = (identifier: EsTreeNode): boolean => {
  if (isWithinAssignmentTarget(identifier)) return false;
  let access = identifier.parent;
  if (
    (isNodeOfType(access, "UnaryExpression") && access.operator === "!") ||
    (isNodeOfType(access, "JSXSpreadAttribute") && access.argument === identifier)
  )
    return true;
  if (!isNodeOfType(access, "MemberExpression") || access.object !== identifier) return false;
  while (isNodeOfType(access.parent, "MemberExpression") && access.parent.object === access) {
    access = access.parent;
  }
  const operation = access.parent;
  return !isNodeOfType(operation, "CallExpression") || operation.callee !== access;
};

const isDeferredNullReset = (
  call: EsTreeNode,
  branchBody: EsTreeNode,
  primary: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.arguments.length !== 1 ||
    !isNodeOfType(call.arguments[0], "Literal") ||
    call.arguments[0].value !== null
  ) {
    return false;
  }
  const callback = findEnclosingFunction(call);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length > 0
  ) {
    return false;
  }
  if (isNodeOfType(callback.body, "BlockStatement")) {
    if (
      callback.body.body.length !== 1 ||
      callback.body.body[0] !== call.parent ||
      !isNodeOfType(call.parent, "ExpressionStatement")
    )
      return false;
  } else if (callback.body !== call) return false;
  const timer = callback.parent;
  if (
    !isNodeOfType(timer, "CallExpression") ||
    timer.optional ||
    timer.arguments.length !== 2 ||
    timer.arguments[0] !== callback ||
    !isNodeOfType(timer.callee, "MemberExpression") ||
    getNativeTimerCalleeName(timer.callee, scopes) !== "setTimeout"
  )
    return false;
  const use = timer.parent;
  const statement =
    isNodeOfType(use, "AssignmentExpression") && use.operator === "=" && use.right === timer
      ? use.parent
      : use;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(branchBody, "BlockStatement") ||
    statement.parent !== branchBody
  )
    return false;
  const primaryIndex = branchBody.body.findIndex((child) => child === primary.parent);
  return (
    primaryIndex >= 0 && branchBody.body.findIndex((child) => child === statement) > primaryIndex
  );
};

export const retainsStateAfterOrderedPropComparison = (
  fact: EffectStateWriteFact,
  effectFunction: EsTreeNode | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (!fact.readsWrittenState || fact.isForwardedWrite || fact.isDeferred || !effectFunction) {
    return false;
  }
  const { callExpression, stateDeclarator, writeSite } = fact;
  if (
    !isNodeOfType(stateDeclarator, "VariableDeclarator") ||
    !isNodeOfType(stateDeclarator.id, "ArrayPattern") ||
    !isNodeOfType(stateDeclarator.id.elements[0], "Identifier") ||
    !isNodeOfType(stateDeclarator.id.elements[1], "Identifier") ||
    !isNodeOfType(writeSite.value, "Identifier") ||
    findEnclosingFunction(callExpression) !== effectFunction
  )
    return false;
  const owner = findEnclosingFunction(stateDeclarator);
  const incoming = scopes.symbolFor(writeSite.value);
  const stored = scopes.symbolFor(stateDeclarator.id.elements[0]);
  const setter = scopes.symbolFor(stateDeclarator.id.elements[1]);
  if (
    !stored ||
    !isSymbolReadOnly(stored) ||
    !setter ||
    !isSymbolReadOnly(setter) ||
    !stored.references.every(({ identifier }) => isPassiveStateUse(identifier)) ||
    incoming?.kind !== "parameter" ||
    !isSymbolReadOnly(incoming) ||
    !isFunctionLike(owner) ||
    !owner.params.some((parameter) => parameter === incoming.bindingIdentifier)
  )
    return false;
  const statement = callExpression.parent;
  const block = statement?.parent;
  const branch = block?.parent;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(block, "BlockStatement") ||
    !isNodeOfType(branch, "IfStatement") ||
    branch.alternate ||
    branch.consequent !== block ||
    !isFunctionLike(effectFunction) ||
    !isNodeOfType(effectFunction.body, "BlockStatement") ||
    effectFunction.body.body.length !== 1 ||
    effectFunction.body.body[0] !== branch ||
    !isRetentionGuard(branch.test, incoming, stored, scopes) ||
    setter.references.length > 2
  )
    return false;
  return setter.references.every(({ identifier, flag }) => {
    const invocation = identifier.parent;
    return (
      flag === "read" &&
      isNodeOfType(invocation, "CallExpression") &&
      !invocation.optional &&
      invocation.callee === identifier &&
      (invocation === callExpression ||
        isDeferredNullReset(invocation, block, callExpression, scopes))
    );
  });
};
