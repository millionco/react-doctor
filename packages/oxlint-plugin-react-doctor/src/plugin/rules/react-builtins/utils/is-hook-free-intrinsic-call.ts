import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../../../constants/thresholds.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasPossibleStaticPropertyWrite } from "../../../utils/has-static-property-write-before.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const builtinCallsByAnalysis = new WeakMap<ScopeAnalysis, Map<string, boolean>>();

const hasOnlyBuiltinCalls = (name: string, scopes: ScopeAnalysis): boolean => {
  const cache = builtinCallsByAnalysis.get(scopes) ?? new Map<string, boolean>();
  builtinCallsByAnalysis.set(scopes, cache);
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const pendingScopes = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) break;
    pendingScopes.push(...scope.children);
    for (const reference of scope.references) {
      const identifier = reference.identifier;
      if (
        !isNodeOfType(identifier, "Identifier") ||
        isTypeScriptTypePosition(identifier) ||
        identifier.name !== name ||
        !scopes.isGlobalReference(identifier)
      )
        continue;
      let member = findTransparentExpressionRoot(identifier);
      while (isNodeOfType(member.parent, "MemberExpression") && member.parent.object === member) {
        member = findTransparentExpressionRoot(member.parent);
      }
      if (!isNodeOfType(member.parent, "CallExpression") || member.parent.callee !== member) {
        cache.set(name, false);
        return false;
      }
    }
  }
  cache.set(name, true);
  return true;
};

const hasOnlyArrayReferences = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visited = new Set<number>(),
): boolean => {
  if (visited.has(symbol.id)) return true;
  if (visited.size >= FUNCTION_RESOLUTION_MAX_DEPTH) return false;
  if (hasPossibleStaticPropertyWrite(symbol.bindingIdentifier, "push", scopes)) return false;
  const nextVisited = new Set(visited).add(symbol.id);
  return symbol.references.every((reference) => {
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const parent = identifier.parent;
    if (!parent) return false;
    if (reference.flag !== "read") {
      return (
        isNodeOfType(parent, "AssignmentExpression") &&
        parent.operator === "=" &&
        parent.left === identifier &&
        (isNodeOfType(stripParenExpression(parent.right), "ArrayExpression") ||
          (isNodeOfType(stripParenExpression(parent.right), "Identifier") &&
            nextVisited.has(scopes.symbolFor(stripParenExpression(parent.right))?.id ?? -1)))
      );
    }
    if (isNodeOfType(parent, "MemberExpression") && parent.object === identifier) {
      const propertyName = getStaticPropertyName(parent);
      return (
        propertyName === "push" || propertyName === "length" || /^\d+$/.test(propertyName ?? "")
      );
    }
    if (isNodeOfType(parent, "ForOfStatement") && parent.right === identifier) return true;
    if (
      isNodeOfType(parent, "CallExpression") &&
      !parent.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    ) {
      const calleeSymbol = resolveConstIdentifierAlias(stripParenExpression(parent.callee), scopes);
      const localFunction = calleeSymbol?.initializer;
      const parameter =
        localFunction && isFunctionLike(localFunction)
          ? localFunction.params[parent.arguments.findIndex((argument) => argument === identifier)]
          : null;
      const parameterSymbol =
        parameter && isNodeOfType(parameter, "Identifier") ? scopes.symbolFor(parameter) : null;
      return Boolean(
        parameterSymbol && hasOnlyArrayReferences(parameterSymbol, scopes, nextVisited),
      );
    }
    const alias =
      isNodeOfType(parent, "VariableDeclarator") && parent.init === identifier
        ? parent.id
        : isNodeOfType(parent, "AssignmentExpression") &&
            parent.operator === "=" &&
            parent.right === identifier
          ? parent.left
          : null;
    const aliasSymbol = alias && isNodeOfType(alias, "Identifier") ? scopes.symbolFor(alias) : null;
    return Boolean(aliasSymbol && hasOnlyArrayReferences(aliasSymbol, scopes, nextVisited));
  });
};

export const isHookFreeIntrinsicCall = (
  call: EsTreeNode,
  scopes: ScopeAnalysis,
  isHookFreeCallback: (callback: EsTreeNode) => boolean,
): boolean => {
  if (!isNodeOfType(call, "CallExpression")) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  const propertyName = getStaticPropertyName(callee);
  if (propertyName === "push") {
    const symbol = resolveConstIdentifierAlias(receiver, scopes);
    return Boolean(
      symbol?.initializer &&
      isNodeOfType(stripParenExpression(symbol.initializer), "ArrayExpression") &&
      hasOnlyBuiltinCalls("Array", scopes) &&
      !hasPossibleStaticPropertyWrite(receiver, "push", scopes) &&
      hasOnlyArrayReferences(symbol, scopes),
    );
  }
  if (
    propertyName === "from" &&
    isProvenUnmodifiedGlobalNamespaceReference(receiver, "Array", scopes, "from") &&
    hasOnlyBuiltinCalls("Array", scopes)
  ) {
    const source = call.arguments[0] && stripParenExpression(call.arguments[0]);
    const callback = call.arguments[1];
    return Boolean(
      source &&
      isNodeOfType(source, "ObjectExpression") &&
      source.properties.length === 1 &&
      getStaticObjectPropertyValue(source, "length") &&
      callback &&
      isHookFreeCallback(callback),
    );
  }
  if (
    propertyName !== "call" ||
    !isNodeOfType(receiver, "MemberExpression") ||
    getStaticPropertyName(receiver) !== "hasOwnProperty"
  ) {
    return false;
  }
  const prototype = stripParenExpression(receiver.object);
  return (
    isNodeOfType(prototype, "MemberExpression") &&
    getStaticPropertyName(prototype) === "prototype" &&
    isProvenUnmodifiedGlobalNamespaceReference(prototype.object, "Object", scopes) &&
    hasOnlyBuiltinCalls("Object", scopes)
  );
};
