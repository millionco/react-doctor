import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getEffectCallback } from "../../../utils/get-effect-callback.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { nodeDominatesNode } from "../../../utils/node-dominates-node.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isClosedFetchEffectLaunch } from "./is-closed-fetch-effect-launch.js";

interface JsonCancellationInput {
  guard: EsTreeNodeOfType<"IfStatement">;
  completionSink: EsTreeNode;
  request: EsTreeNode;
  cancellationFlagKey: string;
  context: RuleContext;
}

interface JsonFieldPath {
  root: EsTreeNodeOfType<"Identifier">;
  properties: string[];
}

const jsonProvidersByAnalysis = new WeakMap<ScopeAnalysis, boolean>();
const modulePredicatesByAnalysis = new WeakMap<ScopeAnalysis, Map<SymbolDescriptor, boolean>>();
const readOnlyDirectCallsBySymbol = new WeakMap<SymbolDescriptor, boolean>();

const JSON_UNSAFE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
  "call",
  "apply",
  "bind",
]);

const JSON_UNSAFE_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "globalThis",
  "global",
  "window",
  "self",
  "eval",
  "Function",
  "Reflect",
  "Proxy",
  "Object",
  "Promise",
  "Response",
  "require",
]);

const JSON_REFLECTIVE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "call",
  "apply",
  "bind",
]);

const JSON_NATIVE_CALLER_NAMES: ReadonlySet<string> = new Set([
  "fetch",
  "Boolean",
  "setInterval",
  "clearInterval",
]);

const JSON_UNSUPPORTED_TYPESCRIPT_RUNTIME_NODES: ReadonlySet<string> = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);

const isReadOnlySymbol = (symbol: SymbolDescriptor | null): symbol is SymbolDescriptor =>
  Boolean(symbol && symbol.references.every((reference) => reference.flag === "read"));

const getReadOnlyConst = (
  identifier: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(identifier);
  return isReadOnlySymbol(symbol) &&
    symbol.kind === "const" &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    symbol.declarationNode.id === symbol.bindingIdentifier
    ? symbol
    : null;
};

const isDirectCallCallee = (identifier: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(identifier);
  return (
    isNodeOfType(root.parent, "CallExpression") &&
    root.parent.callee === root &&
    !root.parent.optional
  );
};

const hasReadOnlyDirectCalls = (symbol: SymbolDescriptor): boolean => {
  const cached = readOnlyDirectCallsBySymbol.get(symbol);
  if (cached !== undefined) return cached;
  const valid = symbol.references.every(
    (reference) => reference.flag === "read" && isDirectCallCallee(reference.identifier),
  );
  readOnlyDirectCallsBySymbol.set(symbol, valid);
  return valid;
};

const isRuntimeNamedReactCall = (
  node: EsTreeNode,
  apiName: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(callee);
  return Boolean(
    symbol &&
    hasReadOnlyDirectCalls(symbol) &&
    getValueImportSource(symbol) === "react" &&
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    getImportedName(symbol.declarationNode) === apiName,
  );
};

const hasUnmodifiedJsonProviders = (program: EsTreeNode, context: RuleContext): boolean => {
  const cached = jsonProvidersByAnalysis.get(context.scopes);
  if (cached !== undefined) return cached;
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (JSON_UNSUPPORTED_TYPESCRIPT_RUNTIME_NODES.has(node.type)) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "ImportExpression") || isNodeOfType(node, "WithStatement")) {
      supported = false;
      return false;
    }
    if (
      isNodeOfType(node, "ObjectPattern") &&
      node.properties.some((property) => !isNodeOfType(property, "Property"))
    ) {
      supported = false;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getStaticPropertyKeyName(node, {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      if (
        propertyName === null ||
        JSON_REFLECTIVE_PROPERTY_NAMES.has(propertyName) ||
        JSON_UNSAFE_GLOBAL_NAMES.has(propertyName) ||
        JSON_NATIVE_CALLER_NAMES.has(propertyName) ||
        propertyName === "Array"
      ) {
        supported = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const reference = context.scopes.referenceFor(node);
    if (!reference) return;
    if (context.scopes.isGlobalReference(node) && JSON_UNSAFE_GLOBAL_NAMES.has(node.name)) {
      supported = false;
      return false;
    }
    const symbol = context.scopes.symbolFor(node);
    if (symbol && getValueImportSource(symbol) === "react") {
      if (
        reference.flag !== "read" ||
        !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
        !isDirectCallCallee(node)
      ) {
        supported = false;
        return false;
      }
    }
    if (!context.scopes.isGlobalReference(node)) return;
    if (JSON_NATIVE_CALLER_NAMES.has(node.name)) {
      if (reference.flag !== "read" || !isDirectCallCallee(node)) supported = false;
    }
    if (node.name === "Array") {
      const member = findTransparentExpressionRoot(node).parent;
      if (
        reference.flag !== "read" ||
        !isNodeOfType(member, "MemberExpression") ||
        member.computed ||
        getStaticPropertyName(member) !== "isArray" ||
        !isDirectCallCallee(member)
      ) {
        supported = false;
      }
    }
  });
  jsonProvidersByAnalysis.set(context.scopes, supported);
  return supported;
};

const isParameterOnlyPredicateExpression = (
  expression: EsTreeNode,
  parameter: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) return true;
  if (isNodeOfType(candidate, "Identifier")) {
    return context.scopes.symbolFor(candidate) === parameter;
  }
  if (isNodeOfType(candidate, "UnaryExpression")) {
    return (
      (candidate.operator === "!" ||
        candidate.operator === "typeof" ||
        candidate.operator === "void") &&
      isParameterOnlyPredicateExpression(candidate.argument, parameter, context)
    );
  }
  if (
    isNodeOfType(candidate, "LogicalExpression") ||
    (isNodeOfType(candidate, "BinaryExpression") &&
      (candidate.operator === "===" || candidate.operator === "!=="))
  ) {
    return (
      isParameterOnlyPredicateExpression(candidate.left, parameter, context) &&
      isParameterOnlyPredicateExpression(candidate.right, parameter, context)
    );
  }
  if (
    !isNodeOfType(candidate, "CallExpression") ||
    candidate.optional ||
    candidate.arguments.length !== 1 ||
    !isParameterOnlyPredicateExpression(candidate.arguments[0], parameter, context)
  ) {
    return false;
  }
  const callee = stripParenExpression(candidate.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return callee.name === "Boolean" && context.scopes.isGlobalReference(callee);
  }
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    !callee.optional &&
    getStaticPropertyName(callee) === "isArray" &&
    isProvenUnmodifiedGlobalNamespaceReference(callee.object, "Array", context.scopes, "isArray")
  );
};

const proveClosedModulePredicate = (symbol: SymbolDescriptor, context: RuleContext): boolean => {
  if (
    !hasReadOnlyDirectCalls(symbol) ||
    symbol.scope !== context.scopes.rootScope ||
    (symbol.kind !== "const" && symbol.kind !== "function") ||
    !symbol.initializer ||
    !isFunctionLike(symbol.initializer) ||
    symbol.initializer.async ||
    symbol.initializer.generator ||
    symbol.initializer.params.length !== 1
  ) {
    return false;
  }
  const parameter = symbol.initializer.params[0];
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const parameterSymbol = context.scopes.symbolFor(parameter);
  const returned = getSingleReturnExpression(symbol.initializer);
  if (
    !isReadOnlySymbol(parameterSymbol) ||
    !returned ||
    !isParameterOnlyPredicateExpression(returned, parameterSymbol, context)
  ) {
    return false;
  }
  let rejectsNull = false;
  let requiresObject = false;
  let rejectsArray = false;
  const pending = [returned];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate) break;
    const expression = stripParenExpression(candidate);
    if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "&&") {
      pending.push(expression.left, expression.right);
      continue;
    }
    if (
      isNodeOfType(expression, "CallExpression") &&
      isNodeOfType(expression.callee, "Identifier") &&
      expression.callee.name === "Boolean" &&
      expression.arguments.length === 1 &&
      context.scopes.symbolFor(stripParenExpression(expression.arguments[0])) === parameterSymbol
    ) {
      rejectsNull = true;
    }
    if (isNodeOfType(expression, "BinaryExpression") && expression.operator === "===") {
      for (const [typeOfValue, literal] of [
        [expression.left, expression.right],
        [expression.right, expression.left],
      ]) {
        if (
          isNodeOfType(typeOfValue, "UnaryExpression") &&
          typeOfValue.operator === "typeof" &&
          context.scopes.symbolFor(stripParenExpression(typeOfValue.argument)) ===
            parameterSymbol &&
          isNodeOfType(literal, "Literal") &&
          literal.value === "object"
        ) {
          requiresObject = true;
        }
      }
    }
    if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
      const call = stripParenExpression(expression.argument);
      if (
        isNodeOfType(call, "CallExpression") &&
        isNodeOfType(call.callee, "MemberExpression") &&
        getStaticPropertyName(call.callee) === "isArray" &&
        call.arguments.length === 1 &&
        context.scopes.symbolFor(stripParenExpression(call.arguments[0])) === parameterSymbol
      ) {
        rejectsArray = true;
      }
    }
  }
  return rejectsNull && requiresObject && rejectsArray;
};

const isClosedModulePredicate = (callee: EsTreeNode, context: RuleContext): boolean => {
  const identifier = stripParenExpression(callee);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol) return false;
  const predicates =
    modulePredicatesByAnalysis.get(context.scopes) ?? new Map<SymbolDescriptor, boolean>();
  modulePredicatesByAnalysis.set(context.scopes, predicates);
  const cached = predicates.get(symbol);
  if (cached !== undefined) return cached;
  const valid = proveClosedModulePredicate(symbol, context);
  predicates.set(symbol, valid);
  return valid;
};

const getJsonFieldPath = (expression: EsTreeNode): JsonFieldPath | null => {
  let candidate = stripParenExpression(expression);
  const properties: string[] = [];
  while (isNodeOfType(candidate, "MemberExpression")) {
    const propertyName = getStaticPropertyName(candidate);
    if (
      candidate.computed ||
      candidate.optional ||
      propertyName === null ||
      JSON_UNSAFE_PROPERTY_NAMES.has(propertyName)
    ) {
      return null;
    }
    properties.unshift(propertyName);
    candidate = stripParenExpression(candidate.object);
  }
  return isNodeOfType(candidate, "Identifier") ? { root: candidate, properties } : null;
};

const hasEmptyJsonFallback = (callback: EsTreeNode): boolean => {
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== 0
  ) {
    return false;
  }
  const returned = getSingleReturnExpression(callback);
  const value = returned ? stripParenExpression(returned) : null;
  return isNodeOfType(value, "ObjectExpression") && value.properties.length === 0;
};

const isResponseOkEarlyExit = (identifier: EsTreeNode, owner: EsTreeNode): boolean => {
  const member = identifier.parent;
  const negation = member?.parent;
  const guard = negation?.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== identifier ||
    member.computed ||
    member.optional ||
    getStaticPropertyName(member) !== "ok" ||
    !isNodeOfType(negation, "UnaryExpression") ||
    negation.operator !== "!" ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.test !== negation ||
    guard.alternate ||
    findEnclosingFunction(guard) !== owner
  ) {
    return false;
  }
  const statements = isNodeOfType(guard.consequent, "BlockStatement")
    ? guard.consequent.body
    : [guard.consequent];
  return (
    statements.length === 1 &&
    isNodeOfType(statements[0], "ReturnStatement") &&
    !statements[0].argument
  );
};

const isNativeJsonPayload = (
  payload: SymbolDescriptor,
  guard: EsTreeNode,
  selectedRequest: EsTreeNode,
  context: RuleContext,
): boolean => {
  const owner = findEnclosingFunction(guard);
  const initializer = payload.initializer ? stripParenExpression(payload.initializer) : null;
  if (
    !owner ||
    !isFunctionLike(owner) ||
    !owner.async ||
    owner.generator ||
    !isNodeOfType(initializer, "AwaitExpression") ||
    payload.declarationNode.parent?.parent !== guard.parent ||
    !nodeDominatesNode(payload.declarationNode, guard, context)
  ) {
    return false;
  }
  let jsonCall = stripParenExpression(initializer.argument);
  if (
    isNodeOfType(jsonCall, "CallExpression") &&
    isNodeOfType(jsonCall.callee, "MemberExpression") &&
    getStaticPropertyName(jsonCall.callee) === "catch"
  ) {
    if (
      jsonCall.optional ||
      jsonCall.callee.optional ||
      jsonCall.callee.computed ||
      jsonCall.arguments.length !== 1 ||
      !hasEmptyJsonFallback(jsonCall.arguments[0])
    ) {
      return false;
    }
    jsonCall = stripParenExpression(jsonCall.callee.object);
  }
  if (
    !isNodeOfType(jsonCall, "CallExpression") ||
    jsonCall.optional ||
    jsonCall.arguments.length !== 0 ||
    !isNodeOfType(jsonCall.callee, "MemberExpression") ||
    jsonCall.callee.computed ||
    jsonCall.callee.optional ||
    getStaticPropertyName(jsonCall.callee) !== "json"
  ) {
    return false;
  }
  const responseIdentifier = stripParenExpression(jsonCall.callee.object);
  const response = getReadOnlyConst(responseIdentifier, context);
  const responseInitializer = response?.initializer
    ? stripParenExpression(response.initializer)
    : null;
  if (
    !response ||
    !isNodeOfType(responseInitializer, "AwaitExpression") ||
    response.declarationNode.parent?.parent !== guard.parent ||
    !nodeDominatesNode(response.declarationNode, payload.declarationNode, context)
  ) {
    return false;
  }
  const request = stripParenExpression(responseInitializer.argument);
  if (
    !isNodeOfType(request, "CallExpression") ||
    request.optional ||
    !isNodeOfType(request.callee, "Identifier") ||
    request.callee.name !== "fetch" ||
    !context.scopes.isGlobalReference(request.callee)
  ) {
    return false;
  }
  if (request !== selectedRequest) return false;
  return response.references.every(
    (reference) =>
      reference.identifier === responseIdentifier ||
      isResponseOkEarlyExit(reference.identifier, owner),
  );
};

const isClosedCancellationFlag = (
  flagReference: EsTreeNode,
  requestFunction: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(flagReference);
  if (
    !symbol ||
    !requestFunction ||
    symbol.kind !== "let" ||
    !isNodeOfType(symbol.initializer, "Literal") ||
    symbol.initializer.value !== false
  ) {
    return false;
  }
  const effect = findEnclosingFunction(symbol.bindingIdentifier);
  if (
    !effect ||
    !isFunctionLike(effect) ||
    effect.async ||
    effect.generator ||
    (isNodeOfType(effect, "FunctionExpression") && effect.id)
  ) {
    return false;
  }
  let hook = effect.parent;
  if (isNodeOfType(hook, "VariableDeclarator")) {
    const callbackSymbol = getReadOnlyConst(hook.id, context);
    if (
      !callbackSymbol ||
      callbackSymbol.initializer !== effect ||
      hook.init !== effect ||
      !isNodeOfType(hook.parent, "VariableDeclaration") ||
      hook.parent.declarations.length !== 1 ||
      callbackSymbol.references.length !== 1
    ) {
      return false;
    }
    const reference = callbackSymbol.references[0].identifier;
    hook = reference.parent;
    if (!isNodeOfType(hook, "CallExpression") || hook.arguments[0] !== reference) return false;
  }
  if (
    !hook ||
    !isRuntimeNamedReactCall(hook, "useEffect", context) ||
    getEffectCallback(hook, context.scopes) !== effect ||
    !isNodeOfType(effect.body, "BlockStatement") ||
    symbol.declarationNode.parent?.parent !== effect.body
  ) {
    return false;
  }
  const otherReferences = symbol.references.filter(
    (reference) => reference.identifier !== flagReference,
  );
  if (otherReferences.length !== 1) return false;
  const write = otherReferences[0];
  const assignment = write.identifier.parent;
  if (
    write.flag !== "write" ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.left !== write.identifier ||
    !isNodeOfType(assignment.right, "Literal") ||
    assignment.right.value !== true
  ) {
    return false;
  }
  const cleanup = findEnclosingFunction(assignment);
  const returned = cleanup?.parent;
  return Boolean(
    cleanup &&
    isFunctionLike(cleanup) &&
    !cleanup.async &&
    !cleanup.generator &&
    cleanup.params.length === 0 &&
    isNodeOfType(cleanup.body, "BlockStatement") &&
    cleanup.body.body[0] === assignment.parent &&
    isNodeOfType(assignment.parent, "ExpressionStatement") &&
    isNodeOfType(returned, "ReturnStatement") &&
    returned.argument === cleanup &&
    effect.body.body[effect.body.body.length - 1] === returned &&
    isNodeOfType(symbol.declarationNode.parent, "VariableDeclaration") &&
    isClosedFetchEffectLaunch({
      effect,
      flagDeclaration: symbol.declarationNode.parent,
      requestFunction,
      cleanup,
      context,
    }),
  );
};

export const isFetchCompletionGuardedByJsonPredicate = ({
  guard,
  completionSink,
  request,
  cancellationFlagKey,
  context,
}: JsonCancellationInput): boolean => {
  if (
    guard.alternate ||
    !isNodeOfType(completionSink, "CallExpression") ||
    completionSink.optional
  ) {
    return false;
  }
  const statement = completionSink.parent;
  const statements = isNodeOfType(guard.consequent, "BlockStatement")
    ? guard.consequent.body
    : [guard.consequent];
  if (
    statements.length !== 1 ||
    statements[0] !== statement ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.expression !== completionSink ||
    !isNodeOfType(completionSink.callee, "Identifier") ||
    completionSink.arguments.length !== 1
  ) {
    return false;
  }
  const statePair = resolveReactUseStatePair(completionSink.callee, context.scopes);
  if (
    !statePair ||
    !isNodeOfType(statePair.declarator.init, "CallExpression") ||
    !isRuntimeNamedReactCall(statePair.declarator.init, "useState", context) ||
    statePair.setterSymbol.bindingIdentifier !==
      context.scopes.symbolFor(completionSink.callee)?.bindingIdentifier ||
    !hasReadOnlyDirectCalls(statePair.setterSymbol)
  ) {
    return false;
  }
  const payloadPath = getJsonFieldPath(completionSink.arguments[0]);
  const payload = payloadPath ? getReadOnlyConst(payloadPath.root, context) : null;
  if (!payload || !payloadPath || !isNativeJsonPayload(payload, guard, request, context))
    return false;
  const permittedPayloadReferences = new Set<EsTreeNode>([payloadPath.root]);
  const conjuncts: EsTreeNode[] = [];
  const pending = [guard.test];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate) break;
    const expression = stripParenExpression(candidate);
    if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "&&") {
      pending.push(expression.right, expression.left);
    } else {
      conjuncts.push(expression);
    }
  }
  const cancellation = conjuncts[0];
  if (
    conjuncts.length < 2 ||
    !isNodeOfType(cancellation, "UnaryExpression") ||
    cancellation.operator !== "!"
  ) {
    return false;
  }
  const flagReference = stripParenExpression(cancellation.argument);
  if (
    !isNodeOfType(flagReference, "Identifier") ||
    resolveExpressionKey(flagReference, context) !== cancellationFlagKey ||
    !isClosedCancellationFlag(flagReference, findEnclosingFunction(guard), context)
  ) {
    return false;
  }
  const recordPaths = new Set<string>();
  const hasRecordOwners = (path: JsonFieldPath): boolean =>
    path.properties.every((_property, index) =>
      recordPaths.has(path.properties.slice(0, index).join(".")),
    );
  for (const conjunct of conjuncts.slice(1)) {
    if (
      !isNodeOfType(conjunct, "CallExpression") ||
      conjunct.optional ||
      conjunct.arguments.length !== 1 ||
      !isClosedModulePredicate(conjunct.callee, context)
    ) {
      return false;
    }
    const argumentPath = getJsonFieldPath(conjunct.arguments[0]);
    if (
      !argumentPath ||
      context.scopes.symbolFor(argumentPath.root) !== payload ||
      !hasRecordOwners(argumentPath)
    ) {
      return false;
    }
    recordPaths.add(argumentPath.properties.join("."));
    permittedPayloadReferences.add(argumentPath.root);
  }
  if (
    !hasRecordOwners(payloadPath) ||
    !payload.references.every((reference) => permittedPayloadReferences.has(reference.identifier))
  ) {
    return false;
  }
  const program = findProgramRoot(guard);
  return Boolean(program && hasUnmodifiedJsonProviders(program, context));
};
