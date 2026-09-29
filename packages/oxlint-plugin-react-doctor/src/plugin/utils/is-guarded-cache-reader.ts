import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isGuardedCacheReader = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    !isNodeOfType(functionNode.body, "BlockStatement")
  ) {
    return false;
  }
  const statements = functionNode.body.body;
  const [returned, store, valueDeclaration, guard, cachedDeclaration] = statements.toReversed();
  if (
    !isNodeOfType(cachedDeclaration, "VariableDeclaration") ||
    cachedDeclaration.kind !== "const" ||
    cachedDeclaration.declarations.length !== 1 ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(valueDeclaration, "VariableDeclaration") ||
    valueDeclaration.kind !== "const" ||
    valueDeclaration.declarations.length !== 1 ||
    !isNodeOfType(store, "ExpressionStatement") ||
    !isNodeOfType(returned, "ReturnStatement")
  ) {
    return false;
  }
  const cached = cachedDeclaration.declarations[0];
  const value = valueDeclaration.declarations[0];
  if (!cached?.init || !value?.init || !returned.argument) return false;
  const read = stripParenExpression(cached.init);
  const write = stripParenExpression(store.expression);
  if (
    !isNodeOfType(read, "CallExpression") ||
    !isNodeOfType(write, "CallExpression") ||
    !isNodeOfType(read.callee, "MemberExpression") ||
    !isNodeOfType(write.callee, "MemberExpression") ||
    read.optional ||
    write.optional ||
    read.callee.optional ||
    write.callee.optional ||
    getStaticPropertyName(read.callee) !== "get" ||
    getStaticPropertyName(write.callee) !== "set" ||
    read.arguments.length !== 1 ||
    write.arguments.length !== 2
  ) {
    return false;
  }
  const cache = resolveConstIdentifierAlias(read.callee.object, scopes);
  if (
    cache?.kind !== "const" ||
    !cache.initializer ||
    findEnclosingFunction(cache.bindingIdentifier) ||
    resolveConstIdentifierAlias(write.callee.object, scopes) !== cache
  ) {
    return false;
  }
  const initializer = stripParenExpression(cache.initializer);
  if (
    !isNodeOfType(initializer, "NewExpression") ||
    !isNodeOfType(initializer.callee, "Identifier") ||
    !["Map", "WeakMap"].includes(initializer.callee.name) ||
    !scopes.isGlobalReference(initializer.callee) ||
    initializer.arguments.length !== 0
  ) {
    return false;
  }
  const guardReturn = isNodeOfType(guard.consequent, "BlockStatement")
    ? guard.consequent.body.length === 1
      ? guard.consequent.body[0]
      : null
    : guard.consequent;
  const cachedSymbol = scopes.symbolFor(cached.id);
  const valueSymbol = scopes.symbolFor(value.id);
  const key = read.arguments[0];
  const storedKey = write.arguments[0];
  const storedValue = write.arguments[1];
  if (
    !cachedSymbol ||
    !valueSymbol ||
    !isNodeOfType(guardReturn, "ReturnStatement") ||
    !guardReturn.argument ||
    !key ||
    !storedKey ||
    !storedValue ||
    scopes.symbolFor(stripParenExpression(guard.test)) !== cachedSymbol ||
    scopes.symbolFor(stripParenExpression(guardReturn.argument)) !== cachedSymbol ||
    scopes.symbolFor(stripParenExpression(storedValue)) !== valueSymbol ||
    scopes.symbolFor(stripParenExpression(returned.argument)) !== valueSymbol
  ) {
    return false;
  }
  const keySymbol = resolveConstIdentifierAlias(stripParenExpression(key), scopes);
  if (
    !keySymbol ||
    keySymbol.references.some((reference) => reference.flag !== "read") ||
    (keySymbol.initializer &&
      ["ObjectExpression", "ArrayExpression", "NewExpression"].includes(
        stripParenExpression(keySymbol.initializer).type,
      )) ||
    resolveConstIdentifierAlias(stripParenExpression(storedKey), scopes) !== keySymbol
  ) {
    return false;
  }
  const readReceiver = read.callee.object;
  const writeReceiver = write.callee.object;
  return cache.references.every(
    (reference) =>
      reference.flag === "read" &&
      (reference.identifier === readReceiver || reference.identifier === writeReceiver),
  );
};
