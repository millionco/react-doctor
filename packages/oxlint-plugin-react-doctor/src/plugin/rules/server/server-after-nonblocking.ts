import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasUseServerDirective } from "../../utils/has-use-server-directive.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";

// HACK: a (object, method) pair counts as "deferrable side effect" when
// it either (a) is a synchronous `console.log/info/warn` (still cheap,
// but the historical behavior of this rule and a real concern when many
// log lines pile up), or (b) is a known analytics/telemetry SDK method
// that genuinely costs a network round trip and IS worth wrapping in
// `after()` so it doesn't delay the user-visible response. Add provider
// names to the analytics object set as new SDKs come up.
const CONSOLE_DEFERRABLE_METHODS = new Set(["log", "info", "warn"]);

const ANALYTICS_DEFERRABLE_OBJECTS = new Set([
  "analytics",
  "posthog",
  "mixpanel",
  "segment",
  "amplitude",
  "datadog",
  "sentry",
]);

const ANALYTICS_DEFERRABLE_METHODS = new Set([
  "track",
  "identify",
  "page",
  "capture",
  "captureMessage",
  "captureException",
  "log",
]);

const isDeferrableSideEffectCall = (objectName: string, methodName: string): boolean => {
  if (objectName === "console") return CONSOLE_DEFERRABLE_METHODS.has(methodName);
  if (ANALYTICS_DEFERRABLE_OBJECTS.has(objectName)) {
    return ANALYTICS_DEFERRABLE_METHODS.has(methodName);
  }
  return false;
};

const NEXT_SERVER_SOURCE = "next/server";
const NEXT_AFTER_EXPORT_NAMES: ReadonlySet<string> = new Set(["after", "unstable_after"]);

const isNextAfterImportSymbol = (symbol: SymbolDescriptor, contextNode: EsTreeNode): boolean => {
  if (symbol.kind !== "import") return false;
  const importBinding = getImportBindingForName(contextNode, symbol.name);
  return Boolean(
    importBinding &&
    importBinding.source === NEXT_SERVER_SOURCE &&
    !importBinding.isNamespace &&
    importBinding.exportedName &&
    NEXT_AFTER_EXPORT_NAMES.has(importBinding.exportedName),
  );
};

const isDirectObjectPatternBinding = (symbol: SymbolDescriptor): boolean => {
  if (!isNodeOfType(symbol.declarationNode, "VariableDeclarator")) return false;
  if (!isNodeOfType(symbol.declarationNode.id, "ObjectPattern")) return false;
  let bindingNode = symbol.bindingIdentifier;
  if (
    isNodeOfType(bindingNode.parent, "AssignmentPattern") &&
    bindingNode.parent.left === bindingNode
  ) {
    bindingNode = bindingNode.parent;
  }
  const property = bindingNode.parent;
  return Boolean(
    isNodeOfType(property, "Property") &&
    property.value === bindingNode &&
    property.parent === symbol.declarationNode.id,
  );
};

const isNextServerNamespace = (
  expression: EsTreeNode,
  contextNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let candidate = stripParenExpression(expression);
  const visitedSymbolIds = new Set<number>();
  while (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    if (symbol.kind === "import") {
      const importBinding = getImportBindingForName(contextNode, symbol.name);
      return Boolean(importBinding?.source === NEXT_SERVER_SOURCE && importBinding.isNamespace);
    }
    if (
      symbol.kind !== "const" ||
      !symbol.initializer ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    candidate = stripParenExpression(symbol.initializer);
  }
  return false;
};

const isNextAfterCallee = (
  callee: EsTreeNode,
  contextNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(callee);
  if (isNodeOfType(candidate, "MemberExpression")) {
    const propertyName = getStaticPropertyKeyName(candidate, { allowComputedString: true });
    return Boolean(
      propertyName &&
      NEXT_AFTER_EXPORT_NAMES.has(propertyName) &&
      isNextServerNamespace(candidate.object, contextNode, scopes),
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  if (isNextAfterImportSymbol(symbol, contextNode)) return true;
  const destructuredPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  if (
    symbol.kind === "const" &&
    symbol.initializer &&
    isDirectObjectPatternBinding(symbol) &&
    destructuredPropertyName &&
    NEXT_AFTER_EXPORT_NAMES.has(destructuredPropertyName)
  ) {
    return isNextServerNamespace(symbol.initializer, contextNode, scopes);
  }
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isNextAfterCallee(symbol.initializer, contextNode, scopes, visitedSymbolIds);
};

const getDirectArgumentCall = (
  expression: EsTreeNode,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const parent = expressionRoot.parent;
  if (!isNodeOfType(parent, "CallExpression")) return null;
  return parent.arguments[0] === expressionRoot ? parent : null;
};

const isScheduledByNextAfter = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const callExpression = getDirectArgumentCall(expression);
  return Boolean(
    callExpression && isNextAfterCallee(callExpression.callee, callExpression, scopes),
  );
};

const getFunctionBindingSymbol = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    return (
      scopes
        .scopeFor(functionNode)
        .symbols.find((symbol) => symbol.declarationNode === functionNode) ?? null
    );
  }
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const parent = functionRoot.parent;
  if (
    !isNodeOfType(parent, "VariableDeclarator") ||
    parent.init !== functionRoot ||
    !isNodeOfType(parent.id, "Identifier")
  ) {
    return null;
  }
  return scopes.symbolFor(parent.id);
};

const isDirectlyExported = (symbol: SymbolDescriptor): boolean => {
  let declaration: EsTreeNode | null | undefined = symbol.declarationNode;
  if (isNodeOfType(declaration, "VariableDeclarator")) declaration = declaration.parent;
  return Boolean(
    declaration?.parent &&
    (isNodeOfType(declaration.parent, "ExportNamedDeclaration") ||
      isNodeOfType(declaration.parent, "ExportDefaultDeclaration")),
  );
};

const isLexicallyInsideFunction = (node: EsTreeNode, functionNode: EsTreeNode): boolean => {
  let enclosingFunction = findEnclosingFunction(node);
  while (enclosingFunction) {
    if (enclosingFunction === functionNode) return true;
    enclosingFunction = findEnclosingFunction(enclosingFunction);
  }
  return false;
};

const isExclusivelyScheduledByNextAfter = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedFunctionSymbolIds: Set<number>,
): boolean => {
  if (isScheduledByNextAfter(functionNode, scopes)) return true;
  const functionSymbol = getFunctionBindingSymbol(functionNode, scopes);
  if (
    !functionSymbol ||
    isDirectlyExported(functionSymbol) ||
    visitedFunctionSymbolIds.has(functionSymbol.id)
  ) {
    return false;
  }
  const nextVisitedFunctionSymbolIds = new Set(visitedFunctionSymbolIds).add(functionSymbol.id);
  let hasAfterUse = false;
  for (const reference of functionSymbol.references) {
    if (reference.flag !== "read") return false;
    if (isLexicallyInsideFunction(reference.identifier, functionNode)) continue;
    if (isScheduledByNextAfter(reference.identifier, scopes)) {
      hasAfterUse = true;
      continue;
    }
    if (!isInsideNextAfterCallback(reference.identifier, scopes, nextVisitedFunctionSymbolIds)) {
      return false;
    }
    hasAfterUse = true;
  }
  return hasAfterUse;
};

const isInsideNextAfterCallback = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedFunctionSymbolIds: Set<number> = new Set<number>(),
): boolean => {
  let enclosingFunction = findEnclosingFunction(node);
  while (enclosingFunction) {
    if (isExclusivelyScheduledByNextAfter(enclosingFunction, scopes, visitedFunctionSymbolIds)) {
      return true;
    }
    enclosingFunction = findEnclosingFunction(enclosingFunction);
  }
  return false;
};

export const serverAfterNonblocking = defineRule({
  id: "server-after-nonblocking",
  title: "Blocking side effect before response",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "`import { after } from 'next/server'`, then wrap it: `after(() => analytics.track(...))`. The response sends right away.",
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;
    let serverFunctionDepth = 0;

    const enterIfServerFunction = (node: EsTreeNode): void => {
      if (hasUseServerDirective(node)) serverFunctionDepth++;
    };
    const leaveIfServerFunction = (node: EsTreeNode): void => {
      if (hasUseServerDirective(node)) serverFunctionDepth = Math.max(0, serverFunctionDepth - 1);
    };

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      FunctionDeclaration: enterIfServerFunction,
      "FunctionDeclaration:exit": leaveIfServerFunction,
      FunctionExpression: enterIfServerFunction,
      "FunctionExpression:exit": leaveIfServerFunction,
      ArrowFunctionExpression: enterIfServerFunction,
      "ArrowFunctionExpression:exit": leaveIfServerFunction,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!fileHasUseServerDirective && serverFunctionDepth === 0) return;
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        if (!isNodeOfType(node.callee.property, "Identifier")) return;

        const receiver = stripParenExpression(node.callee.object);
        const objectName = isNodeOfType(receiver, "Identifier") ? receiver.name : null;
        if (!objectName) return;

        const methodName = node.callee.property.name;
        if (!isDeferrableSideEffectCall(objectName, methodName)) return;

        if (isInsideNextAfterCallback(node, context.scopes)) return;

        context.report({
          node,
          message: `${objectName}.${methodName}() runs before the response, so your users wait longer for it.`,
        });
      },
    };
  },
});
