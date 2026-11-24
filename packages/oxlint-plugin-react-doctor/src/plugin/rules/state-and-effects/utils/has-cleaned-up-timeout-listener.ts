import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const DYNAMIC_DOCUMENT_REFERENCE_NAMES = new Set([
  "Document",
  "EventTarget",
  "Function",
  "HTMLDocument",
  "Node",
  "Window",
  "XMLDocument",
  "eval",
  "event",
  "global",
  "globalThis",
  "self",
  "window",
]);

const DOCUMENT_ACCESSOR_NAMES = new Set(["contentDocument", "defaultView", "ownerDocument"]);

const readStatementCall = (statement: EsTreeNode | null | undefined) => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const expression = stripParenExpression(statement.expression);
  return isNodeOfType(expression, "CallExpression") && !expression.optional ? expression : null;
};

const isDirectEffectDeclaration = (
  declaration: EsTreeNode,
  effectBody: EsTreeNodeOfType<"BlockStatement">,
  before: EsTreeNode,
): boolean =>
  isNodeOfType(declaration, "VariableDeclarator") &&
  isNodeOfType(declaration.parent, "VariableDeclaration") &&
  declaration.parent.parent === effectBody &&
  declaration.range[0] < before.range[0];

const isNativeGlobalIdentifier = (
  expression: EsTreeNode,
  name: string,
  context: RuleContext,
): boolean =>
  isNodeOfType(expression, "Identifier") &&
  expression.name === name &&
  context.scopes.isGlobalReference(expression) &&
  isProvenUnmodifiedGlobalNamespaceReference(expression, name, context.scopes, undefined, true);

const hasClosedDocumentReferences = (
  documentReferences: readonly EsTreeNode[],
  context: RuleContext,
): boolean => {
  let isClosed = true;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (!isClosed) return false;
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const keyName = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (keyName === null || DOCUMENT_ACCESSOR_NAMES.has(keyName)) {
        isClosed = false;
        return false;
      }
    }
    if (
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "MemberExpression") &&
        DOCUMENT_ACCESSOR_NAMES.has(getStaticPropertyName(node) ?? "")) ||
      (isNodeOfType(node, "Identifier") &&
        context.scopes.isGlobalReference(node) &&
        (DYNAMIC_DOCUMENT_REFERENCE_NAMES.has(node.name) ||
          (node.name === "document" && !documentReferences.includes(node))))
    ) {
      isClosed = false;
      return false;
    }
  });
  return isClosed;
};

const isPairedNativeReceiver = (
  target: EsTreeNode,
  releaseTarget: EsTreeNode,
  effectBody: EsTreeNodeOfType<"BlockStatement">,
  scheduler: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (isNativeGlobalIdentifier(target, "document", context)) {
    return (
      isNativeGlobalIdentifier(releaseTarget, "document", context) &&
      hasClosedDocumentReferences([target, releaseTarget], context)
    );
  }
  if (!isNodeOfType(target, "Identifier") || !isNodeOfType(releaseTarget, "Identifier")) {
    return false;
  }
  const symbol = context.scopes.symbolFor(target);
  if (
    !symbol ||
    context.scopes.symbolFor(releaseTarget) !== symbol ||
    !isDirectEffectDeclaration(symbol.declarationNode, effectBody, scheduler)
  ) {
    return false;
  }
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return false;
  const document = stripParenExpression(initializer);
  return (
    isNativeGlobalIdentifier(document, "document", context) &&
    symbol.references.length === 2 &&
    symbol.references.every(
      ({ identifier, flag }) =>
        flag === "read" && (identifier === target || identifier === releaseTarget),
    ) &&
    hasClosedDocumentReferences([document], context)
  );
};

export const hasCleanedUpTimeoutListener = (
  effectBody: EsTreeNodeOfType<"BlockStatement">,
  registration: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const registrationCallee = stripParenExpression(registration.callee);
  const registrationExpression = findTransparentExpressionRoot(registration);
  const registrationStatement = registrationExpression.parent;
  const timerBody = registrationStatement?.parent;
  const timerCallback = timerBody?.parent;
  if (
    registration.optional ||
    registration.arguments.length !== 2 ||
    !isNodeOfType(registrationCallee, "MemberExpression") ||
    registrationCallee.optional ||
    getStaticPropertyName(registrationCallee) !== "addEventListener" ||
    !isNodeOfType(timerBody, "BlockStatement") ||
    !isFunctionLike(timerCallback) ||
    timerCallback.body !== timerBody ||
    timerCallback.async ||
    timerCallback.generator ||
    timerCallback.params.length !== 0 ||
    timerBody.body.length !== 2 ||
    timerBody.body[1] !== registrationStatement ||
    readStatementCall(registrationStatement) !== registration
  ) {
    return false;
  }
  const timerExpression = findTransparentExpressionRoot(timerCallback);
  const scheduler = timerExpression.parent;
  if (
    !isNodeOfType(scheduler, "CallExpression") ||
    scheduler.optional ||
    scheduler.arguments.length !== 2 ||
    scheduler.arguments[0] !== timerExpression ||
    !isNativeGlobalIdentifier(stripParenExpression(scheduler.callee), "setTimeout", context) ||
    !isNodeOfType(scheduler.arguments[1], "Literal") ||
    typeof scheduler.arguments[1].value !== "number"
  ) {
    return false;
  }
  const timerDeclarator = findTransparentExpressionRoot(scheduler).parent;
  const timerDeclaration = timerDeclarator?.parent;
  if (
    !isNodeOfType(timerDeclarator, "VariableDeclarator") ||
    !isNodeOfType(timerDeclarator.id, "Identifier") ||
    !isNodeOfType(timerDeclaration, "VariableDeclaration") ||
    timerDeclaration.kind !== "const" ||
    timerDeclaration.declarations.length !== 1 ||
    timerDeclaration.parent !== effectBody
  ) {
    return false;
  }
  const declarationIndex = effectBody.body.findIndex((statement) => statement === timerDeclaration);
  if (declarationIndex < 0) return false;
  const cleanupReturn = effectBody.body[declarationIndex + 1];
  const cleanup =
    isNodeOfType(cleanupReturn, "ReturnStatement") && cleanupReturn.argument
      ? stripParenExpression(cleanupReturn.argument)
      : null;
  if (
    !isFunctionLike(cleanup) ||
    cleanup.async ||
    cleanup.generator ||
    cleanup.params.length !== 0 ||
    !isNodeOfType(cleanup.body, "BlockStatement") ||
    cleanup.body.body.length !== 2
  ) {
    return false;
  }
  const [cancelStatement, releaseGuard] = cleanup.body.body;
  const cancel = readStatementCall(cancelStatement);
  const timerSymbol = context.scopes.symbolFor(timerDeclarator.id);
  if (
    !cancel ||
    cancel.arguments.length !== 1 ||
    !isNativeGlobalIdentifier(stripParenExpression(cancel.callee), "clearTimeout", context) ||
    !timerSymbol ||
    context.scopes.symbolFor(stripParenExpression(cancel.arguments[0])) !== timerSymbol ||
    timerSymbol.references.length !== 1 ||
    timerSymbol.references[0].flag !== "read" ||
    !isNodeOfType(releaseGuard, "IfStatement") ||
    releaseGuard.alternate
  ) {
    return false;
  }
  const [activationStatement] = timerBody.body;
  const activation = isNodeOfType(activationStatement, "ExpressionStatement")
    ? stripParenExpression(activationStatement.expression)
    : null;
  const guard = stripParenExpression(releaseGuard.test);
  if (
    !isNodeOfType(activation, "AssignmentExpression") ||
    activation.operator !== "=" ||
    !isNodeOfType(activation.left, "Identifier") ||
    !isNodeOfType(activation.right, "Literal") ||
    activation.right.value !== true ||
    !isNodeOfType(guard, "Identifier")
  ) {
    return false;
  }
  const flag = context.scopes.symbolFor(guard);
  if (
    flag?.kind !== "let" ||
    context.scopes.symbolFor(activation.left) !== flag ||
    !isDirectEffectDeclaration(flag.declarationNode, effectBody, scheduler) ||
    !isNodeOfType(flag.initializer, "Literal") ||
    flag.initializer.value !== false ||
    flag.references.length !== 2 ||
    !flag.references.some(
      ({ identifier, flag }) => identifier === activation.left && flag === "write",
    ) ||
    !flag.references.some(({ identifier, flag }) => identifier === guard && flag === "read")
  ) {
    return false;
  }
  const releaseBranch = releaseGuard.consequent;
  const release = readStatementCall(
    isNodeOfType(releaseBranch, "BlockStatement") && releaseBranch.body.length === 1
      ? releaseBranch.body[0]
      : releaseBranch,
  );
  const releaseCallee = release ? stripParenExpression(release.callee) : null;
  if (
    !release ||
    release.arguments.length !== 2 ||
    !isNodeOfType(releaseCallee, "MemberExpression") ||
    releaseCallee.optional ||
    getStaticPropertyName(releaseCallee) !== "removeEventListener"
  ) {
    return false;
  }
  const event = stripParenExpression(registration.arguments[0]);
  const releasedEvent = stripParenExpression(release.arguments[0]);
  const handler = stripParenExpression(registration.arguments[1]);
  const releasedHandler = stripParenExpression(release.arguments[1]);
  if (
    !isNodeOfType(event, "Literal") ||
    typeof event.value !== "string" ||
    !isNodeOfType(releasedEvent, "Literal") ||
    releasedEvent.value !== event.value ||
    !isNodeOfType(handler, "Identifier") ||
    !isNodeOfType(releasedHandler, "Identifier")
  ) {
    return false;
  }
  const handlerSymbol = context.scopes.symbolFor(handler);
  const handlerInitializer = handlerSymbol && getDirectConstInitializer(handlerSymbol);
  return Boolean(
    handlerSymbol &&
    context.scopes.symbolFor(releasedHandler) === handlerSymbol &&
    isDirectEffectDeclaration(handlerSymbol.declarationNode, effectBody, scheduler) &&
    isNodeOfType(handlerInitializer, "ArrowFunctionExpression") &&
    handlerInitializer.params.length === 0 &&
    handlerSymbol.references.length === 2 &&
    handlerSymbol.references.every(
      ({ identifier, flag }) =>
        flag === "read" && (identifier === handler || identifier === releasedHandler),
    ) &&
    isPairedNativeReceiver(
      stripParenExpression(registrationCallee.object),
      stripParenExpression(releaseCallee.object),
      effectBody,
      scheduler,
      context,
    ),
  );
};
