import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { unwrapDiscardedExpression } from "../../../utils/unwrap-discarded-expression.js";

interface ClosedFetchEffectLaunchInput {
  effect: EsTreeNode;
  flagDeclaration: EsTreeNode;
  requestFunction: EsTreeNode;
  cleanup: EsTreeNode;
  context: RuleContext;
}

const isNativeTimerCall = (
  expression: EsTreeNode,
  calleeName: string,
  context: RuleContext,
): boolean =>
  isNodeOfType(expression, "CallExpression") &&
  !expression.optional &&
  isNodeOfType(expression.callee, "Identifier") &&
  expression.callee.name === calleeName &&
  context.scopes.isGlobalReference(expression.callee);

const isRequestInvocation = (
  expression: EsTreeNode,
  requestSymbol: SymbolDescriptor,
  permittedReferences: Set<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const call = unwrapDiscardedExpression(expression);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 0 ||
    !isNodeOfType(call.callee, "Identifier") ||
    context.scopes.symbolFor(call.callee) !== requestSymbol
  ) {
    return false;
  }
  permittedReferences.add(call.callee);
  return true;
};

export const isClosedFetchEffectLaunch = ({
  effect,
  flagDeclaration,
  requestFunction,
  cleanup,
  context,
}: ClosedFetchEffectLaunchInput): boolean => {
  if (
    !isFunctionLike(effect) ||
    !isNodeOfType(effect.body, "BlockStatement") ||
    !isFunctionLike(requestFunction) ||
    !requestFunction.async ||
    requestFunction.generator ||
    requestFunction.params.length !== 0 ||
    !isFunctionLike(cleanup) ||
    !isNodeOfType(cleanup.body, "BlockStatement")
  ) {
    return false;
  }
  if (
    effect.body.body.some(
      (statement) =>
        isNodeOfType(statement, "VariableDeclaration") &&
        statement.kind !== "const" &&
        statement.kind !== "let" &&
        statement.kind !== "var",
    )
  ) {
    return false;
  }
  const declarator = requestFunction.parent;
  const declaration = declarator?.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== requestFunction ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1
  ) {
    return false;
  }
  const requestSymbol = context.scopes.symbolFor(declarator.id);
  if (!requestSymbol || requestSymbol.kind !== "const") return false;
  const flagIndex = effect.body.body.findIndex((statement) => statement === flagDeclaration);
  if (flagIndex < 0) return false;
  const tail = effect.body.body.slice(flagIndex + 1);
  if (
    (tail.length !== 3 && tail.length !== 4) ||
    tail[0] !== declaration ||
    tail[tail.length - 1] !== cleanup.parent ||
    !isNodeOfType(tail[1], "ExpressionStatement")
  ) {
    return false;
  }
  const permittedReferences = new Set<EsTreeNode>();
  if (!isRequestInvocation(tail[1], requestSymbol, permittedReferences, context)) return false;
  if (tail.length === 3) {
    return (
      cleanup.body.body.length === 1 &&
      requestSymbol.references.every(
        (reference) => reference.flag === "read" && permittedReferences.has(reference.identifier),
      )
    );
  }
  const timerDeclaration = tail[2];
  if (
    !isNodeOfType(timerDeclaration, "VariableDeclaration") ||
    timerDeclaration.kind !== "const" ||
    timerDeclaration.declarations.length !== 1 ||
    cleanup.body.body.length !== 2
  ) {
    return false;
  }
  const timer = timerDeclaration.declarations[0];
  if (
    !isNodeOfType(timer.id, "Identifier") ||
    !isNodeOfType(timer.init, "CallExpression") ||
    !isNativeTimerCall(timer.init, "setInterval", context) ||
    timer.init.arguments.length !== 2
  ) {
    return false;
  }
  const callback = stripParenExpression(timer.init.arguments[0]);
  const delay = stripParenExpression(timer.init.arguments[1]);
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== 0 ||
    !isNodeOfType(delay, "Literal") ||
    typeof delay.value !== "number" ||
    !Number.isFinite(delay.value) ||
    delay.value < 0
  ) {
    return false;
  }
  const callbackBody = isNodeOfType(callback.body, "BlockStatement")
    ? callback.body.body
    : [callback.body];
  if (
    callbackBody.length !== 1 ||
    !isRequestInvocation(callbackBody[0], requestSymbol, permittedReferences, context)
  ) {
    return false;
  }
  const timerSymbol = context.scopes.symbolFor(timer.id);
  const release = cleanup.body.body[1];
  if (!timerSymbol || !isNodeOfType(release, "ExpressionStatement")) return false;
  const releaseCall = stripParenExpression(release.expression);
  if (
    !isNodeOfType(releaseCall, "CallExpression") ||
    !isNativeTimerCall(releaseCall, "clearInterval", context) ||
    releaseCall.arguments.length !== 1 ||
    !isNodeOfType(releaseCall.arguments[0], "Identifier") ||
    context.scopes.symbolFor(releaseCall.arguments[0]) !== timerSymbol
  ) {
    return false;
  }
  return (
    timerSymbol.references.every(
      (reference) => reference.flag === "read" && reference.identifier === releaseCall.arguments[0],
    ) &&
    requestSymbol.references.every(
      (reference) => reference.flag === "read" && permittedReferences.has(reference.identifier),
    )
  );
};
