import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const hasOnlyReferences = (
  scopes: ScopeAnalysis,
  binding: EsTreeNode,
  references: ReadonlyArray<EsTreeNode>,
): boolean => {
  const symbol = scopes.symbolFor(binding);
  return (
    symbol?.bindingIdentifier === binding &&
    symbol.references.length === references.length &&
    symbol.references.every(({ identifier }) => references.includes(identifier))
  );
};

const isUnshadowedTimerCall = (
  node: EsTreeNode | null | undefined,
  name: "clearTimeout" | "setTimeout",
  scopes: ScopeAnalysis,
): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isNodeOfType(node.callee, "Identifier") &&
  node.callee.name === name &&
  scopes.isGlobalReference(node.callee);

// Certifies the body of an already-resolved provider. The caller still needs
// the effective module resolution, an inline callback with stock Function.apply,
// a literal delay, and the stock timers for the runtime being analyzed.
export const isDeferredCallbackForwardingProvider = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(node, "FunctionDeclaration") ||
    node.async ||
    node.generator ||
    node.params.length !== 2 ||
    node.body.body.length !== 2
  ) {
    return false;
  }

  const [callback, wait] = node.params;
  const [timerDeclaration, returned] = node.body.body;
  if (
    !isNodeOfType(callback, "Identifier") ||
    !isNodeOfType(wait, "Identifier") ||
    !isNodeOfType(timerDeclaration, "VariableDeclaration") ||
    timerDeclaration.kind !== "let" ||
    timerDeclaration.declarations.length !== 1 ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "FunctionExpression")
  ) {
    return false;
  }

  const [timer] = timerDeclaration.declarations;
  const wrapper = returned.argument;
  if (
    !timer ||
    !isNodeOfType(timer.id, "Identifier") ||
    timer.init != null ||
    wrapper.async ||
    wrapper.generator ||
    wrapper.body.body.length !== 2
  ) {
    return false;
  }

  const [firstParameter, secondParameter] = wrapper.params;
  const hasTypeScriptThisParameter =
    isNodeOfType(firstParameter, "Identifier") &&
    firstParameter.name === "this" &&
    firstParameter.typeAnnotation != null;
  const rest = hasTypeScriptThisParameter ? secondParameter : firstParameter;
  const [clearStatement, scheduleStatement] = wrapper.body.body;
  if (
    wrapper.params.length !== (hasTypeScriptThisParameter ? 2 : 1) ||
    !isNodeOfType(rest, "RestElement") ||
    !isNodeOfType(rest.argument, "Identifier") ||
    !isNodeOfType(clearStatement, "ExpressionStatement") ||
    !isUnshadowedTimerCall(clearStatement.expression, "clearTimeout", scopes) ||
    clearStatement.expression.arguments.length !== 1 ||
    !isNodeOfType(scheduleStatement, "ExpressionStatement") ||
    !isNodeOfType(scheduleStatement.expression, "AssignmentExpression") ||
    scheduleStatement.expression.operator !== "="
  ) {
    return false;
  }

  const [timerRead] = clearStatement.expression.arguments;
  const { left: timerWrite, right: schedule } = scheduleStatement.expression;
  if (
    !isNodeOfType(timerRead, "Identifier") ||
    !isNodeOfType(timerWrite, "Identifier") ||
    !isUnshadowedTimerCall(schedule, "setTimeout", scopes) ||
    schedule.arguments.length !== 2
  ) {
    return false;
  }

  const [deferred, delay] = schedule.arguments;
  if (
    !isNodeOfType(delay, "Identifier") ||
    !isNodeOfType(deferred, "ArrowFunctionExpression") ||
    deferred.async ||
    deferred.params.length !== 0 ||
    !isNodeOfType(deferred.body, "BlockStatement") ||
    deferred.body.body.length !== 1
  ) {
    return false;
  }

  const [forwardStatement] = deferred.body.body;
  if (
    !isNodeOfType(forwardStatement, "ExpressionStatement") ||
    !isNodeOfType(forwardStatement.expression, "CallExpression") ||
    forwardStatement.expression.optional ||
    forwardStatement.expression.arguments.length !== 2
  ) {
    return false;
  }

  const { callee, arguments: forwardArgs } = forwardStatement.expression;
  const [receiver, args] = forwardArgs;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    !callee.optional &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "apply" &&
    isNodeOfType(callee.object, "Identifier") &&
    isNodeOfType(receiver, "ThisExpression") &&
    isNodeOfType(args, "Identifier") &&
    hasOnlyReferences(scopes, callback, [callee.object]) &&
    hasOnlyReferences(scopes, wait, [delay]) &&
    hasOnlyReferences(scopes, timer.id, [timerRead, timerWrite]) &&
    hasOnlyReferences(scopes, rest.argument, [args])
  );
};
