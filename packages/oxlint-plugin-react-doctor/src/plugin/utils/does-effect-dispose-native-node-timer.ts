import { TIMER_CALLEE_NAMES_REQUIRING_CLEANUP } from "../constants/dom.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const OPAQUE_TIMER_ENVIRONMENT_NAMES = new Set([
  "globalThis",
  "global",
  "window",
  "self",
  "document",
  "process",
  "module",
  "require",
  "Object",
  "Reflect",
  "Proxy",
  "eval",
  "Function",
]);
const OPAQUE_TIMER_PROPERTY_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "defaultView",
]);

const hasClosedNodeTimerEnvironment = (
  importDeclaration: EsTreeNode,
  disposer: EsTreeNode,
  symbolIdentifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  let hasOpaqueAccess = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (hasOpaqueAccess || node === importDeclaration) return false;
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (node.importKind !== "type" && node.source.value !== "react") {
        hasOpaqueAccess = true;
      }
      return false;
    }
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ExportAllDeclaration") ||
      (isNodeOfType(node, "ExportNamedDeclaration") && node.source)
    ) {
      hasOpaqueAccess = true;
      return false;
    }
    if (isNodeOfType(node, "Identifier") && context.scopes.referenceFor(node)) {
      if (
        OPAQUE_TIMER_ENVIRONMENT_NAMES.has(node.name) ||
        (node.name === "Symbol" && node !== symbolIdentifier) ||
        (TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(node.name) &&
          context.scopes.isGlobalReference(node))
      ) {
        hasOpaqueAccess = true;
      }
      return;
    }
    if (isNodeOfType(node, "MemberExpression") && node !== disposer) {
      const propertyName = getStaticPropertyName(node);
      if (
        propertyName === null ||
        OPAQUE_TIMER_PROPERTY_NAMES.has(propertyName) ||
        TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(propertyName)
      ) {
        hasOpaqueAccess = true;
      }
    }
  });
  return !hasOpaqueAccess;
};

export const doesEffectDisposeNativeNodeTimer = (
  effectCallback: EsTreeNode,
  registration: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (
    !isFunctionLike(effectCallback) ||
    effectCallback.async ||
    effectCallback.generator ||
    effectCallback.params.length !== 0 ||
    !isNodeOfType(effectCallback.body, "BlockStatement") ||
    effectCallback.body.body.length !== 2 ||
    registration.optional ||
    registration.arguments.length !== 2
  ) {
    return false;
  }
  const [scheduleCallback, delay] = registration.arguments;
  if (
    !scheduleCallback ||
    !isNodeOfType(stripParenExpression(scheduleCallback), "ArrowFunctionExpression") ||
    isNodeOfType(delay, "SpreadElement")
  ) {
    return false;
  }
  const [allocation, cleanupReturn] = effectCallback.body.body;
  if (
    !isNodeOfType(allocation, "VariableDeclaration") ||
    allocation.kind !== "const" ||
    allocation.declarations.length !== 1 ||
    !isNodeOfType(cleanupReturn, "ReturnStatement") ||
    !cleanupReturn.argument
  ) {
    return false;
  }
  const [handle] = allocation.declarations;
  if (!handle || handle.init !== registration || !isNodeOfType(handle.id, "Identifier"))
    return false;
  const cleanup = stripParenExpression(cleanupReturn.argument);
  if (!isFunctionLike(cleanup) || cleanup.async || cleanup.generator || cleanup.params.length) {
    return false;
  }
  const cleanupStatement =
    isNodeOfType(cleanup.body, "BlockStatement") && cleanup.body.body.length === 1
      ? cleanup.body.body[0]
      : null;
  const cleanupExpression = isNodeOfType(cleanupStatement, "ExpressionStatement")
    ? cleanupStatement.expression
    : getSingleReturnExpression(cleanup);
  if (!cleanupExpression) return false;
  const cleanupCall = stripParenExpression(cleanupExpression);
  if (
    !isNodeOfType(cleanupCall, "CallExpression") ||
    cleanupCall.optional ||
    cleanupCall.arguments.length
  ) {
    return false;
  }
  const disposer = stripParenExpression(cleanupCall.callee);
  if (!isNodeOfType(disposer, "MemberExpression") || !disposer.computed || disposer.optional) {
    return false;
  }
  const receiver = stripParenExpression(disposer.object);
  const key = stripParenExpression(disposer.property);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    !isNodeOfType(key, "MemberExpression") ||
    key.optional ||
    getStaticPropertyName(key) !== "dispose"
  ) {
    return false;
  }
  const handleSymbol = context.scopes.symbolFor(receiver);
  if (
    handleSymbol?.bindingIdentifier !== handle.id ||
    handleSymbol.references.length !== 1 ||
    handleSymbol.references[0]?.identifier !== receiver
  ) {
    return false;
  }
  const symbolIdentifier = stripParenExpression(key.object);
  if (
    !isNodeOfType(symbolIdentifier, "Identifier") ||
    symbolIdentifier.name !== "Symbol" ||
    !context.scopes.isGlobalReference(symbolIdentifier)
  ) {
    return false;
  }
  const factory = stripParenExpression(registration.callee);
  if (!isNodeOfType(factory, "Identifier")) return false;
  const factorySymbol = context.scopes.symbolFor(factory);
  if (
    !factorySymbol ||
    !isNodeOfType(factorySymbol.declarationNode, "ImportSpecifier") ||
    factorySymbol.references.length !== 1 ||
    factorySymbol.references[0]?.identifier !== factory
  ) {
    return false;
  }
  const imported = resolveImportedApiReference(factory, context.scopes);
  const importDeclaration = getImportDeclarationForSymbol(factorySymbol);
  return Boolean(
    imported?.source === "node:timers" &&
    imported.importedName === factory.name &&
    TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(factory.name) &&
    importDeclaration?.specifiers.length === 1 &&
    hasClosedNodeTimerEnvironment(importDeclaration, disposer, symbolIdentifier, context),
  );
};
