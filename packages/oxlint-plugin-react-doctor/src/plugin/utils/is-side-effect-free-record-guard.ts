import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import {
  isGlobalNamespaceUnmodified,
  isProvenUnmodifiedGlobalNamespaceReference,
} from "./is-proven-unmodified-global-namespace-reference.js";
import {
  isProvenGlobalObjectReference,
  isProvenGlobalNamespaceReference,
} from "./is-proven-global-namespace-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { someAst } from "./some-ast.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";

const JSON_PROTOTYPE_NAMESPACES = ["Object", "Response", "Promise"];
const OPAQUE_RUNTIME_APIS = ["Function", "Reflect", "eval"];
const PROTOTYPE_ACCESS_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "getPrototypeOf",
  "setPrototypeOf",
]);
const nativeJsonRuntimeByScopes = new WeakMap<ScopeAnalysis, boolean>();

const getRecordPredicateArgument = (
  expression: EsTreeNode,
  context: RuleContext,
): { predicate: EsTreeNode; argument: EsTreeNode } | null => {
  const call = stripParenExpression(expression);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 1 ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return null;
  const scopes = context.scopes;
  const [argument] = call.arguments;
  if (!argument || isNodeOfType(argument, "SpreadElement")) return null;
  const binding = scopes.symbolFor(call.callee);
  const predicate = resolveExactLocalFunction(call.callee, scopes);
  if (
    !binding ||
    !isFunctionLike(predicate) ||
    predicate.async ||
    predicate.generator ||
    predicate.params.length !== 1 ||
    binding.references.some((reference) => reference.flag !== "read") ||
    !hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes)
  ) {
    return null;
  }
  const ownInitializer = getDirectConstInitializer(binding);
  if (
    binding.declarationNode !== predicate &&
    (!ownInitializer || stripParenExpression(ownInitializer) !== predicate)
  )
    return null;

  const [parameter] = predicate.params;
  const parameterBinding = isNodeOfType(parameter, "Identifier")
    ? scopes.symbolFor(parameter)
    : null;
  const isParameter = (node: EsTreeNode | undefined): boolean =>
    Boolean(
      node && parameterBinding && scopes.symbolFor(stripParenExpression(node)) === parameterBinding,
    );
  const returned = getSingleReturnExpression(predicate);
  const outer = returned && stripParenExpression(returned);
  if (!isNodeOfType(outer, "LogicalExpression") || outer.operator !== "&&") return null;
  const prefix = stripParenExpression(outer.left);
  const notArray = stripParenExpression(outer.right);
  if (
    !isNodeOfType(prefix, "LogicalExpression") ||
    prefix.operator !== "&&" ||
    !isNodeOfType(notArray, "UnaryExpression") ||
    notArray.operator !== "!"
  )
    return null;
  const truthy = stripParenExpression(prefix.left);
  const objectCheck = stripParenExpression(prefix.right);
  const arrayCheck = stripParenExpression(notArray.argument);
  if (
    !isNodeOfType(truthy, "CallExpression") ||
    truthy.optional ||
    truthy.arguments.length !== 1 ||
    !isParameter(truthy.arguments[0]) ||
    !isProvenUnmodifiedGlobalNamespaceReference(
      truthy.callee,
      "Boolean",
      scopes,
      undefined,
      true,
    ) ||
    !isNodeOfType(objectCheck, "BinaryExpression") ||
    objectCheck.operator !== "===" ||
    !isNodeOfType(objectCheck.left, "UnaryExpression") ||
    objectCheck.left.operator !== "typeof" ||
    !isParameter(objectCheck.left.argument) ||
    !isNodeOfType(objectCheck.right, "Literal") ||
    objectCheck.right.value !== "object" ||
    !isNodeOfType(arrayCheck, "CallExpression") ||
    arrayCheck.optional ||
    arrayCheck.arguments.length !== 1 ||
    !isParameter(arrayCheck.arguments[0]) ||
    !isNodeOfType(arrayCheck.callee, "MemberExpression") ||
    arrayCheck.callee.optional ||
    getStaticPropertyName(arrayCheck.callee) !== "isArray" ||
    !isProvenUnmodifiedGlobalNamespaceReference(
      arrayCheck.callee.object,
      "Array",
      scopes,
      "isArray",
      true,
    )
  ) {
    return null;
  }
  return { predicate, argument: stripParenExpression(argument) };
};

const hasOpaqueRuntimeAccess = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const memberKey = isNodeOfType(node, "MemberExpression") ? getStaticPropertyName(node) : null;
  if (
    isNodeOfType(node, "MemberExpression") &&
    ((node.computed &&
      memberKey === null &&
      (!isNodeOfType(node.property, "Literal") || typeof node.property.value !== "number")) ||
      (memberKey !== null && PROTOTYPE_ACCESS_KEYS.has(memberKey)))
  ) {
    return true;
  }
  if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
    const key = getStaticPropertyKeyName(node);
    if (key === null || PROTOTYPE_ACCESS_KEYS.has(key)) return true;
  }
  const name = isNodeOfType(node, "Identifier") ? node.name : memberKey;
  if (!name) return false;
  if (OPAQUE_RUNTIME_APIS.includes(name) && isProvenGlobalNamespaceReference(node, name, scopes)) {
    return true;
  }
  const isGlobalObject =
    isNodeOfType(node, "Identifier") &&
    (name === "globalThis" || name === "window" || name === "self" || name === "global") &&
    isProvenGlobalObjectReference(node, scopes);
  const isJsonNamespace =
    JSON_PROTOTYPE_NAMESPACES.includes(name) &&
    isProvenGlobalNamespaceReference(node, name, scopes);
  if (!isGlobalObject && !isJsonNamespace) return false;

  const parent = node.parent;
  if (
    isJsonNamespace &&
    (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
    parent.callee === node
  )
    return false;
  return (
    !isNodeOfType(parent, "MemberExpression") ||
    parent.object !== node ||
    getStaticPropertyName(parent) === null
  );
};

const hasOrdinaryJsonRuntime = (scopes: ScopeAnalysis): boolean => {
  const cached = nativeJsonRuntimeByScopes.get(scopes);
  if (cached !== undefined) return cached;
  const result =
    JSON_PROTOTYPE_NAMESPACES.every((name) => isGlobalNamespaceUnmodified(name, scopes)) &&
    !someAst(scopes.rootScope.node, (node) => hasOpaqueRuntimeAccess(node, scopes));
  nativeJsonRuntimeByScopes.set(scopes, result);
  return result;
};

const isClosedNativeJsonBinding = (identifier: EsTreeNode, context: RuleContext): boolean => {
  const scopes = context.scopes;
  const jsonBinding = scopes.symbolFor(identifier);
  const initializer = jsonBinding && getDirectConstInitializer(jsonBinding);
  const value = initializer && stripParenExpression(initializer);
  if (
    !jsonBinding ||
    !isNodeOfType(value, "AwaitExpression") ||
    !hasCompleteSymbolReferences(jsonBinding, scopes.rootScope.node, scopes)
  )
    return false;
  let jsonCall = stripParenExpression(value.argument);
  if (
    !isNodeOfType(jsonCall, "CallExpression") ||
    jsonCall.optional ||
    !isNodeOfType(jsonCall.callee, "MemberExpression") ||
    jsonCall.callee.optional
  )
    return false;
  if (getStaticPropertyName(jsonCall.callee) === "catch") {
    const [fallback] = jsonCall.arguments;
    if (
      jsonCall.arguments.length !== 1 ||
      !isNodeOfType(fallback, "ArrowFunctionExpression") ||
      fallback.params.length !== 0 ||
      fallback.async
    )
      return false;
    const expression = getSingleReturnExpression(fallback);
    const fallbackValue = expression && stripParenExpression(expression);
    if (!isNodeOfType(fallbackValue, "ObjectExpression") || fallbackValue.properties.length !== 0)
      return false;
    jsonCall = stripParenExpression(jsonCall.callee.object);
  }
  if (
    !isNodeOfType(jsonCall, "CallExpression") ||
    jsonCall.optional ||
    jsonCall.arguments.length !== 0 ||
    !isNodeOfType(jsonCall.callee, "MemberExpression") ||
    jsonCall.callee.optional ||
    getStaticPropertyName(jsonCall.callee) !== "json" ||
    !isNodeOfType(jsonCall.callee.object, "Identifier")
  )
    return false;
  const response = scopes.symbolFor(jsonCall.callee.object);
  const responseInitializer = response && getDirectConstInitializer(response);
  const awaited = responseInitializer && stripParenExpression(responseInitializer);
  const fetchCall = isNodeOfType(awaited, "AwaitExpression")
    ? stripParenExpression(awaited.argument)
    : null;
  if (
    !response ||
    !isNodeOfType(fetchCall, "CallExpression") ||
    fetchCall.optional ||
    !isProvenUnmodifiedGlobalNamespaceReference(
      fetchCall.callee,
      "fetch",
      scopes,
      undefined,
      true,
    ) ||
    !hasCompleteSymbolReferences(response, scopes.rootScope.node, scopes)
  )
    return false;
  const jsonRead = jsonCall.callee;
  return response.references.every((reference) => {
    const parent = reference.identifier.parent;
    return (
      reference.flag === "read" &&
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === reference.identifier &&
      (parent === jsonRead ||
        (getStaticPropertyName(parent) === "ok" && !isWithinAssignmentTarget(parent)))
    );
  });
};

export const isSideEffectFreeRecordGuard = (
  expression: EsTreeNode,
  context: RuleContext,
  isSafePrefix: (expression: EsTreeNode) => boolean,
): boolean => {
  const direct = getRecordPredicateArgument(expression, context);
  if (direct && isNodeOfType(direct.argument, "Identifier"))
    return hasOrdinaryJsonRuntime(context.scopes);
  if (
    !isNodeOfType(expression, "LogicalExpression") ||
    expression.operator !== "&&" ||
    !isNodeOfType(expression.parent, "IfStatement") ||
    expression.parent.test !== expression
  )
    return false;
  const left = stripParenExpression(expression.left);
  const conjunction =
    isNodeOfType(left, "LogicalExpression") && left.operator === "&&" ? left : null;
  const record = getRecordPredicateArgument(conjunction?.right ?? left, context);
  const field = getRecordPredicateArgument(expression.right, context);
  if (
    !record ||
    !field ||
    record.predicate !== field.predicate ||
    !isNodeOfType(record.argument, "Identifier") ||
    !isNodeOfType(field.argument, "MemberExpression") ||
    field.argument.optional ||
    !isNodeOfType(field.argument.object, "Identifier")
  )
    return false;
  const scopes = context.scopes;
  const binding = scopes.symbolFor(record.argument);
  const property = getStaticPropertyName(field.argument);
  if (
    !binding ||
    !property ||
    property === "__proto__" ||
    property === "constructor" ||
    scopes.symbolFor(field.argument.object) !== binding
  )
    return false;

  const branch = expression.parent.consequent;
  const statement =
    isNodeOfType(branch, "BlockStatement") && branch.body.length === 1 ? branch.body[0] : branch;
  const call = isNodeOfType(statement, "ExpressionStatement")
    ? stripParenExpression(statement.expression)
    : null;
  const argument =
    isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    isNodeOfType(call.callee, "Identifier") &&
    call.arguments.length === 1
      ? call.arguments[0]
      : null;
  const payload = argument && stripParenExpression(argument);
  if (
    !isNodeOfType(payload, "MemberExpression") ||
    payload.optional ||
    !isNodeOfType(payload.object, "Identifier") ||
    getStaticPropertyName(payload) !== property ||
    scopes.symbolFor(payload.object) !== binding
  )
    return false;
  const allowedReferences = new Set<EsTreeNode>([
    record.argument,
    field.argument.object,
    payload.object,
  ]);
  return (
    binding.references.length === allowedReferences.size &&
    binding.references.every(
      (reference) => reference.flag === "read" && allowedReferences.has(reference.identifier),
    ) &&
    hasOrdinaryJsonRuntime(scopes) &&
    isClosedNativeJsonBinding(record.argument, context) &&
    (!conjunction || isSafePrefix(conjunction.left))
  );
};
