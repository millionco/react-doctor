import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { readPassiveLoadingPair } from "./read-passive-loading-pair.js";

type PassiveLoadingPair = NonNullable<ReturnType<typeof readPassiveLoadingPair>>;

const readMemberCall = (statement: EsTreeNode | undefined) => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const call = statement.expression;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.optional ||
    call.callee.computed ||
    !isNodeOfType(call.callee.property, "Identifier")
  ) {
    return null;
  }
  return { call, name: call.callee.property.name, receiver: call.callee.object };
};

const readCurrentReceiver = (node: EsTreeNode) =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.object, "Identifier") &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "current"
    ? node.object
    : null;

// Allow only the reset's final call to a direct private cache disposal. The
// disposed object may schedule work or throw. A renderer committing this
// effect either proceeds to the adjacent launch or handles a commit error.
export const hasClosedResetFirstPreviewDisposal = (
  statement: EsTreeNode,
  pair: PassiveLoadingPair,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement") || !isFunctionLike(owner)) return false;
  const disposal = statement.expression;
  const { binding, callback } = pair.stableReset;
  if (
    !isNodeOfType(disposal, "CallExpression") ||
    disposal.optional ||
    disposal.arguments.length !== 0 ||
    !isNodeOfType(disposal.callee, "Identifier") ||
    context.scopes.symbolFor(disposal.callee) !== binding ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 2
  ) {
    return false;
  }
  const [iterate, empty] = callback.body.body.map(readMemberCall);
  const disposeValue = iterate?.call.arguments[0];
  if (
    iterate?.name !== "forEach" ||
    iterate.call.arguments.length !== 1 ||
    empty?.name !== "clear" ||
    empty.call.arguments.length !== 0 ||
    !isNodeOfType(disposeValue, "ArrowFunctionExpression") ||
    disposeValue.async ||
    disposeValue.params.length !== 1 ||
    !isNodeOfType(disposeValue.params[0], "Identifier") ||
    !isNodeOfType(disposeValue.body, "BlockStatement") ||
    disposeValue.body.body.length !== 1
  ) {
    return false;
  }
  const destroy = readMemberCall(disposeValue.body.body[0]);
  const value = context.scopes.symbolFor(disposeValue.params[0]);
  if (
    destroy?.name !== "destroy" ||
    destroy.call.arguments.length !== 0 ||
    !isNodeOfType(destroy.receiver, "Identifier") ||
    !value ||
    context.scopes.symbolFor(destroy.receiver) !== value
  ) {
    return false;
  }
  const receiver = readCurrentReceiver(iterate.receiver);
  const emptyReceiver = readCurrentReceiver(empty.receiver);
  const cache = receiver && context.scopes.symbolFor(receiver);
  const hook = cache?.initializer;
  const initializer = isNodeOfType(hook, "CallExpression") ? hook.arguments[0] : null;
  if (
    !cache ||
    cache.kind !== "const" ||
    cache.declarationNode.parent?.parent !== owner.body ||
    !emptyReceiver ||
    context.scopes.symbolFor(emptyReceiver) !== cache ||
    !isNodeOfType(hook, "CallExpression") ||
    hook.optional ||
    hook.arguments.length !== 1 ||
    !isReactApiCall(hook, "useRef", context.scopes) ||
    !isNodeOfType(initializer, "NewExpression") ||
    !isNodeOfType(initializer.callee, "Identifier") ||
    initializer.callee.name !== "Map" ||
    !context.scopes.isGlobalReference(initializer.callee) ||
    initializer.arguments.length !== 0 ||
    !hasCompleteSymbolReferences(cache, owner, context.scopes)
  ) {
    return false;
  }
  return cache.references.every(({ flag, identifier }) => {
    const current = identifier.parent;
    if (
      flag !== "read" ||
      !current ||
      readCurrentReceiver(current) !== identifier ||
      isWithinAssignmentTarget(current)
    ) {
      return false;
    }
    if (current === iterate.receiver || current === empty.receiver) return true;
    const method = current.parent;
    const call = method?.parent;
    return (
      isNodeOfType(method, "MemberExpression") &&
      method.object === current &&
      !method.computed &&
      !method.optional &&
      isNodeOfType(method.property, "Identifier") &&
      isNodeOfType(call, "CallExpression") &&
      call.callee === method &&
      !call.optional &&
      (method.property.name === "get" || method.property.name === "set") &&
      findEnclosingFunction(call) !== owner
    );
  });
};
