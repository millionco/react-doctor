import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface ClosedFetchHelper {
  request: EsTreeNode;
  helper: EsTreeNode;
  nativeReferences: Set<EsTreeNode>;
}

const sameBinding = (
  candidate: EsTreeNode | null | undefined,
  binding: EsTreeNode,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(binding);
  return Boolean(
    symbol &&
    candidate &&
    isNodeOfType(candidate, "Identifier") &&
    context.scopes.symbolFor(candidate) === symbol,
  );
};

const getReadonlyConst = (
  statement: EsTreeNode | undefined,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return null;
  const [declarator, ...otherDeclarations] = statement.declarations;
  if (
    otherDeclarations.length > 0 ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier")
  ) {
    return null;
  }
  const symbol = context.scopes.symbolFor(declarator.id);
  return symbol && isSymbolReadOnly(symbol) ? symbol : null;
};

const getPlainMethodCall = (expression: EsTreeNode | null | undefined, name: string) => {
  if (!expression) return null;
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.optional) return null;
  const callee = stripParenExpression(call.callee);
  return isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    !callee.optional &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === name
    ? { call, receiver: stripParenExpression(callee.object) }
    : null;
};

const isClosedResponseReader = (callback: EsTreeNode, context: RuleContext): boolean => {
  if (!isFunctionLike(callback) || callback.async || callback.generator) return false;
  const [parameter, ...otherParameters] = callback.params;
  if (!isNodeOfType(parameter, "Identifier") || otherParameters.length > 0) return false;
  const returned = getSingleReturnExpression(callback);
  const reader = getPlainMethodCall(returned, "text") ?? getPlainMethodCall(returned, "json");
  const symbol = context.scopes.symbolFor(parameter);
  return Boolean(
    reader &&
    reader.call.arguments.length === 0 &&
    sameBinding(reader.receiver, parameter, context) &&
    symbol &&
    symbol.references.every((reference) => reference.identifier === reader.receiver),
  );
};

const getClosedNativeRequest = (
  expression: EsTreeNode,
  parameter: EsTreeNode,
  helper: EsTreeNode,
  context: RuleContext,
): ClosedFetchHelper | null => {
  let current = stripParenExpression(expression);
  const fallback = getPlainMethodCall(current, "catch");
  if (fallback) {
    const [callback, ...otherArguments] = fallback.call.arguments;
    if (
      !isFunctionLike(callback) ||
      callback.async ||
      callback.generator ||
      callback.params.length > 0 ||
      otherArguments.length > 0 ||
      !isNodeOfType(getSingleReturnExpression(callback), "Literal")
    ) {
      return null;
    }
    current = fallback.receiver;
  }
  const reader = getPlainMethodCall(current, "then");
  if (reader) {
    const [callback, ...otherArguments] = reader.call.arguments;
    if (!callback || otherArguments.length > 0 || !isClosedResponseReader(callback, context)) {
      return null;
    }
    current = reader.receiver;
  }
  if (!isNodeOfType(current, "CallExpression") || current.optional) return null;
  const callee = stripParenExpression(current.callee);
  const [address, ...otherArguments] = current.arguments;
  if (
    !isNodeOfType(callee, "Identifier") ||
    callee.name !== "fetch" ||
    context.scopes.symbolFor(callee) ||
    !sameBinding(address, parameter, context) ||
    otherArguments.length > 0
  ) {
    return null;
  }
  return { request: current, helper, nativeReferences: new Set([callee]) };
};

const getClosedHelper = (
  invocation: EsTreeNode,
  context: RuleContext,
): ClosedFetchHelper | null => {
  if (!isNodeOfType(invocation, "CallExpression") || invocation.optional) return null;
  if (!isNodeOfType(invocation.callee, "Identifier")) return null;
  const helperSymbol = context.scopes.symbolFor(invocation.callee);
  if (
    !helperSymbol ||
    !helperSymbol.references.every((reference) => reference.identifier === invocation.callee) ||
    helperSymbol.declarationNode.parent?.type === "ExportNamedDeclaration" ||
    helperSymbol.declarationNode.parent?.parent?.type === "ExportNamedDeclaration" ||
    helperSymbol.declarationNode.parent?.type === "ExportDefaultDeclaration"
  ) {
    return null;
  }
  const [argument, ...otherArguments] = invocation.arguments;
  if (!isNodeOfType(argument, "Identifier") || otherArguments.length > 0) return null;
  const helper = resolveExactLocalFunction(invocation.callee, context.scopes);
  if (!isFunctionLike(helper) || helper.async || helper.generator) return null;
  if (!helperSymbol.initializer || stripParenExpression(helperSymbol.initializer) !== helper) {
    return null;
  }
  const [parameter, ...otherParameters] = helper.params;
  if (!isNodeOfType(parameter, "Identifier") || otherParameters.length > 0) return null;
  const parameterSymbol = context.scopes.symbolFor(parameter);
  if (!parameterSymbol || !isSymbolReadOnly(parameterSymbol)) return null;

  const directReturn = getSingleReturnExpression(helper);
  if (directReturn) return getClosedNativeRequest(directReturn, parameter, helper, context);
  if (!isNodeOfType(helper.body, "BlockStatement")) return null;
  const [first, second, third, fourth, fifth, ...otherStatements] = helper.body.body;
  if (otherStatements.length > 0) return null;
  const firstBinding = getReadonlyConst(first, context);
  if (!firstBinding?.initializer) return null;
  if (!third && !fourth && !fifth && isNodeOfType(second, "ReturnStatement")) {
    return sameBinding(second.argument, firstBinding.bindingIdentifier, context)
      ? getClosedNativeRequest(firstBinding.initializer, parameter, helper, context)
      : null;
  }

  const cached = getPlainMethodCall(firstBinding.initializer, "get");
  if (!cached || !isNodeOfType(cached.receiver, "Identifier")) return null;
  const [lookupKey, ...otherLookupArguments] = cached.call.arguments;
  const cache = context.scopes.symbolFor(cached.receiver);
  if (
    !sameBinding(lookupKey, parameter, context) ||
    otherLookupArguments.length > 0 ||
    !cache ||
    cache.kind !== "const" ||
    cache.scope.kind !== "module" ||
    !isSymbolReadOnly(cache) ||
    cache.declarationNode.parent?.parent?.type !== "Program" ||
    !isNodeOfType(cache.initializer, "NewExpression") ||
    cache.initializer.arguments.length > 0 ||
    !isNodeOfType(cache.initializer.callee, "Identifier") ||
    cache.initializer.callee.name !== "Map" ||
    context.scopes.symbolFor(cache.initializer.callee)
  ) {
    return null;
  }
  if (
    !isNodeOfType(second, "IfStatement") ||
    second.alternate ||
    !sameBinding(second.test, firstBinding.bindingIdentifier, context) ||
    !isNodeOfType(second.consequent, "ReturnStatement") ||
    !sameBinding(second.consequent.argument, firstBinding.bindingIdentifier, context)
  ) {
    return null;
  }
  const pending = getReadonlyConst(third, context);
  const inserted = isNodeOfType(fourth, "ExpressionStatement")
    ? getPlainMethodCall(fourth.expression, "set")
    : null;
  if (!pending?.initializer || !inserted) return null;
  const [insertionKey, insertionValue, ...otherInsertionArguments] = inserted.call.arguments;
  if (
    !sameBinding(inserted.receiver, cached.receiver, context) ||
    !sameBinding(insertionKey, parameter, context) ||
    !sameBinding(insertionValue, pending.bindingIdentifier, context) ||
    otherInsertionArguments.length > 0 ||
    !isNodeOfType(fifth, "ReturnStatement") ||
    !sameBinding(fifth.argument, pending.bindingIdentifier, context) ||
    !cache.references.every(
      (reference) =>
        reference.identifier === cached.receiver || reference.identifier === inserted.receiver,
    )
  ) {
    return null;
  }
  const proof = getClosedNativeRequest(pending.initializer, parameter, helper, context);
  if (proof) proof.nativeReferences.add(cache.initializer.callee);
  return proof;
};

export const isManagedLocalFetchEffect = (
  effectCall: EsTreeNode,
  effectCallback: EsTreeNode,
  requests: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const [request, ...otherRequests] = requests;
  if (
    !request ||
    otherRequests.length > 0 ||
    !isFunctionLike(effectCallback) ||
    effectCallback.async ||
    effectCallback.generator
  ) {
    return false;
  }
  if (!isNodeOfType(effectCall, "CallExpression")) return false;
  const [callbackArgument] = effectCall.arguments;
  if (!callbackArgument || stripParenExpression(callbackArgument) !== effectCallback) return false;
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) return false;
  const [flagStatement, launchStatement, cleanupStatement, ...otherStatements] =
    effectCallback.body.body;
  if (otherStatements.length > 0) return false;
  if (!isNodeOfType(flagStatement, "VariableDeclaration") || flagStatement.kind !== "let") {
    return false;
  }
  const [flag, ...otherFlags] = flagStatement.declarations;
  if (
    otherFlags.length > 0 ||
    !isNodeOfType(flag, "VariableDeclarator") ||
    !isNodeOfType(flag.id, "Identifier") ||
    !isNodeOfType(flag.init, "Literal") ||
    flag.init.value !== false ||
    !isNodeOfType(launchStatement, "ExpressionStatement") ||
    !isNodeOfType(cleanupStatement, "ReturnStatement")
  ) {
    return false;
  }
  let launch = stripParenExpression(launchStatement.expression);
  if (isNodeOfType(launch, "UnaryExpression") && launch.operator === "void") {
    launch = stripParenExpression(launch.argument);
  }
  const subscription = getPlainMethodCall(launch, "then");
  if (!subscription) return false;
  const proof = getClosedHelper(subscription.receiver, context);
  if (!proof || proof.request !== request) return false;
  const [completion, ...otherCallbacks] = subscription.call.arguments;
  if (
    !isFunctionLike(completion) ||
    completion.async ||
    completion.generator ||
    otherCallbacks.length > 0 ||
    !isNodeOfType(completion.body, "BlockStatement")
  ) {
    return false;
  }
  const [valueParameter, ...otherParameters] = completion.params;
  const [guard, ...otherCompletionStatements] = completion.body.body;
  if (
    !isNodeOfType(valueParameter, "Identifier") ||
    otherParameters.length > 0 ||
    otherCompletionStatements.length > 0 ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "UnaryExpression") ||
    guard.test.operator !== "!" ||
    !sameBinding(guard.test.argument, flag.id, context) ||
    !isNodeOfType(guard.consequent, "ExpressionStatement") ||
    !isNodeOfType(guard.consequent.expression, "CallExpression")
  ) {
    return false;
  }
  const setterCall = guard.consequent.expression;
  const [value, ...otherValues] = setterCall.arguments;
  if (!isNodeOfType(setterCall.callee, "Identifier")) return false;
  const setter = context.scopes.symbolFor(setterCall.callee);
  const declaration = setter?.declarationNode;
  if (
    !setter ||
    !isSymbolReadOnly(setter) ||
    !setter.references.every((reference) => reference.identifier === setterCall.callee) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isReactApiCall(declaration.init, "useState", context.scopes) ||
    !sameBinding(value, valueParameter, context) ||
    otherValues.length > 0 ||
    setterCall.optional
  ) {
    return false;
  }
  const [, setterBinding] = declaration.id.elements;
  if (setterBinding !== setter.bindingIdentifier) return false;
  const cleanup = cleanupStatement.argument;
  if (!isFunctionLike(cleanup) || cleanup.async || cleanup.generator || cleanup.params.length > 0) {
    return false;
  }
  let assignment = cleanup.body;
  if (isNodeOfType(assignment, "BlockStatement")) {
    const [statement, ...otherCleanupStatements] = assignment.body;
    if (otherCleanupStatements.length > 0 || !isNodeOfType(statement, "ExpressionStatement")) {
      return false;
    }
    assignment = statement.expression;
  }
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !sameBinding(assignment.left, flag.id, context) ||
    !isNodeOfType(assignment.right, "Literal") ||
    assignment.right.value !== true
  ) {
    return false;
  }
  const flagSymbol = context.scopes.symbolFor(flag.id);
  const cancellationRead = guard.test.argument;
  const cancellationWrite = assignment.left;
  if (
    !flagSymbol ||
    !flagSymbol.references.every(
      (reference) =>
        reference.identifier === cancellationRead || reference.identifier === cancellationWrite,
    )
  ) {
    return false;
  }
  let providersUntouched = true;
  const allowedCalls = new Set([
    effectCall,
    declaration.init,
    subscription.call,
    subscription.receiver,
    setterCall,
  ]);
  walkAst(proof.helper, (node) => {
    if (isNodeOfType(node, "CallExpression")) allowedCalls.add(node);
  });
  walkAst(context.scopes.rootScope.node, (node) => {
    if (
      (isNodeOfType(node, "CallExpression") && !allowedCalls.has(node)) ||
      (isNodeOfType(node, "NewExpression") && !proof.nativeReferences.has(node.callee)) ||
      node.type === "ImportExpression" ||
      node.type === "TaggedTemplateExpression" ||
      (isNodeOfType(node, "ImportDeclaration") && node.source.value !== "react") ||
      node.type === "ExportAllDeclaration" ||
      (isNodeOfType(node, "ExportNamedDeclaration") && Boolean(node.source))
    ) {
      providersUntouched = false;
    }
    if (
      (isNodeOfType(node, "AssignmentExpression") && node !== assignment) ||
      isNodeOfType(node, "UpdateExpression") ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
    ) {
      providersUntouched = false;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      !context.scopes.symbolFor(node) &&
      context.scopes.referenceFor(node) &&
      [
        "fetch",
        "Map",
        "Object",
        "Reflect",
        "globalThis",
        "window",
        "self",
        "eval",
        "Function",
      ].includes(node.name) &&
      !proof.nativeReferences.has(node)
    ) {
      providersUntouched = false;
    }
  });
  return providersUntouched;
};
