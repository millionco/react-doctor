import { TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES } from "../../constants/dom.js";
import { REACT_HANDLER_PROP_PATTERN, SUBSCRIPTION_METHOD_NAMES } from "../../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getFunctionBindingIdentifier } from "../../utils/get-function-binding-name.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const VALTIO_REACT_MODULE_SOURCES = new Set(["valtio", "valtio/react"]);
const DEFERRED_REACT_HOOK_NAMES = new Set(["useEffect", "useInsertionEffect", "useLayoutEffect"]);
const PROMISE_CONTINUATION_METHOD_NAMES = new Set(["catch", "finally", "then"]);
const DEFERRED_CONSTRUCTOR_NAMES = new Set([
  "IntersectionObserver",
  "MutationObserver",
  "PerformanceObserver",
  "ResizeObserver",
]);

const isValtioImport = (symbol: SymbolDescriptor): boolean => {
  const source = getImportDeclarationForSymbol(symbol)?.source.value;
  return typeof source === "string" && VALTIO_REACT_MODULE_SOURCES.has(source);
};

const resolvesToValtioNamespace = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  if (
    symbol.kind === "import" &&
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") &&
    isValtioImport(symbol)
  ) {
    return true;
  }
  const initializer = getDirectUnreassignedInitializer(symbol);
  if (!initializer) return false;
  visitedSymbolIds.add(symbol.id);
  return resolvesToValtioNamespace(initializer, scopes, visitedSymbolIds);
};

const isValtioUseSnapshotCallee = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    if (
      symbol.kind === "import" &&
      isValtioImport(symbol) &&
      getImportedName(symbol.declarationNode) === "useSnapshot"
    ) {
      return true;
    }
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) return false;
    visitedSymbolIds.add(symbol.id);
    return isValtioUseSnapshotCallee(initializer, scopes, visitedSymbolIds);
  }
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    getStaticPropertyName(candidate) !== "useSnapshot"
  ) {
    return false;
  }
  return resolvesToValtioNamespace(candidate.object, scopes, visitedSymbolIds);
};

const getSnapshotOriginCall = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): EsTreeNodeOfType<"CallExpression"> | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "CallExpression")) {
    return isValtioUseSnapshotCallee(candidate.callee, context.scopes) ? candidate : null;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  const initializer = getDirectUnreassignedInitializer(symbol);
  if (!initializer) return null;
  visitedSymbolIds.add(symbol.id);
  return getSnapshotOriginCall(initializer, context, visitedSymbolIds);
};

const isJsxEventHandlerValue = (expression: EsTreeNode): boolean => {
  const expressionContainer = expression.parent;
  if (!isNodeOfType(expressionContainer, "JSXExpressionContainer")) return false;
  const attribute = expressionContainer.parent;
  return Boolean(
    isNodeOfType(attribute, "JSXAttribute") &&
    isNodeOfType(attribute.name, "JSXIdentifier") &&
    REACT_HANDLER_PROP_PATTERN.test(attribute.name.name),
  );
};

const isGlobalDeferredFunctionCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (
    isNodeOfType(callee, "Identifier") &&
    TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES.has(callee.name)
  ) {
    return context.scopes.isGlobalReference(callee);
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  if (!methodName || !TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES.has(methodName)) return false;
  const receiver = stripParenExpression(callee.object);
  return Boolean(
    isNodeOfType(receiver, "Identifier") &&
    (receiver.name === "globalThis" || receiver.name === "window") &&
    context.scopes.isGlobalReference(receiver),
  );
};

const isDeferredCallbackArgument = (expression: EsTreeNode, context: RuleContext): boolean => {
  const parent = expression.parent;
  if (isNodeOfType(parent, "NewExpression")) {
    const callee = stripParenExpression(parent.callee);
    return Boolean(
      parent.arguments?.[0] === expression &&
      isNodeOfType(callee, "Identifier") &&
      DEFERRED_CONSTRUCTOR_NAMES.has(callee.name) &&
      context.scopes.isGlobalReference(callee),
    );
  }
  if (!isNodeOfType(parent, "CallExpression")) return false;
  if (!(parent.arguments ?? []).some((argument) => argument === expression)) return false;
  if (
    parent.arguments?.[0] === expression &&
    isReactApiCall(parent, DEFERRED_REACT_HOOK_NAMES, context.scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    })
  ) {
    return true;
  }
  if (parent.arguments?.[0] === expression && isGlobalDeferredFunctionCall(parent, context)) {
    return true;
  }
  const callee = stripParenExpression(parent.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  return Boolean(
    methodName &&
    (SUBSCRIPTION_METHOD_NAMES.has(methodName) ||
      PROMISE_CONTINUATION_METHOD_NAMES.has(methodName)),
  );
};

const isReactEffectCallbackValue = (expression: EsTreeNode, context: RuleContext): boolean => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const parent = expressionRoot.parent;
  return Boolean(
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments?.[0] === expressionRoot &&
    isReactApiCall(parent, DEFERRED_REACT_HOOK_NAMES, context.scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    }),
  );
};

const isSymbolUsedAsReactEffectCallback = (
  symbol: SymbolDescriptor,
  context: RuleContext,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  return symbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    if (isReactEffectCallbackValue(referenceRoot, context)) return true;
    const aliasSymbol = getConstAliasSymbol(referenceRoot, context);
    return Boolean(
      aliasSymbol && isSymbolUsedAsReactEffectCallback(aliasSymbol, context, visitedSymbolIds),
    );
  });
};

const isFunctionUsedAsReactEffectCallback = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (isReactEffectCallbackValue(functionNode, context)) return true;
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  const symbol = bindingIdentifier ? context.scopes.symbolFor(bindingIdentifier) : null;
  return Boolean(symbol && isSymbolUsedAsReactEffectCallback(symbol, context, new Set()));
};

const isReactEffectCleanupValue = (expression: EsTreeNode, context: RuleContext): boolean => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const returnStatement = expressionRoot.parent;
  if (
    isNodeOfType(returnStatement, "ArrowFunctionExpression") &&
    returnStatement.body === expressionRoot
  ) {
    return isFunctionUsedAsReactEffectCallback(returnStatement, context);
  }
  if (
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    returnStatement.argument !== expressionRoot
  ) {
    return false;
  }
  const effectCallback = findEnclosingFunction(returnStatement);
  return Boolean(effectCallback && isFunctionUsedAsReactEffectCallback(effectCallback, context));
};

const isDeferredCallbackValue = (expression: EsTreeNode, context: RuleContext): boolean =>
  isJsxEventHandlerValue(expression) ||
  isDeferredCallbackArgument(expression, context) ||
  isReactEffectCleanupValue(expression, context);

const getConstAliasSymbol = (
  expression: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const declarator = expressionRoot.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== expressionRoot ||
    !isNodeOfType(declarator.id, "Identifier")
  ) {
    return null;
  }
  const aliasSymbol = context.scopes.symbolFor(declarator.id);
  return aliasSymbol?.kind === "const" ? aliasSymbol : null;
};

const isCallTarget = (expression: EsTreeNode): EsTreeNodeOfType<"CallExpression"> | null => {
  const parent = expression.parent;
  return isNodeOfType(parent, "CallExpression") && parent.callee === expression ? parent : null;
};

const getSynchronousCallbackInvocation = (
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  if (!executesDuringRender(expression, context.scopes)) return null;
  const parent = expression.parent;
  return isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")
    ? parent
    : null;
};

const isNodeExecutedFromDeferredCallback = (
  node: EsTreeNode,
  snapshotOwner: EsTreeNode,
  context: RuleContext,
  visitedFunctionSymbolIds: Set<number>,
): boolean => {
  const enclosingFunction = findEnclosingFunction(node);
  if (!enclosingFunction || enclosingFunction === snapshotOwner) return false;
  return isFunctionExecutedAsDeferredCallback(
    enclosingFunction,
    snapshotOwner,
    context,
    visitedFunctionSymbolIds,
  );
};

const isSymbolExecutedAsDeferredCallback = (
  symbol: SymbolDescriptor,
  snapshotOwner: EsTreeNode,
  context: RuleContext,
  visitedFunctionSymbolIds: Set<number>,
): boolean => {
  if (visitedFunctionSymbolIds.has(symbol.id)) return false;
  visitedFunctionSymbolIds.add(symbol.id);
  return symbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    if (isDeferredCallbackValue(referenceRoot, context)) return true;
    const aliasSymbol = getConstAliasSymbol(referenceRoot, context);
    if (
      aliasSymbol &&
      isSymbolExecutedAsDeferredCallback(
        aliasSymbol,
        snapshotOwner,
        context,
        visitedFunctionSymbolIds,
      )
    ) {
      return true;
    }
    const callTarget = isCallTarget(referenceRoot);
    if (callTarget) {
      return isNodeExecutedFromDeferredCallback(
        callTarget,
        snapshotOwner,
        context,
        visitedFunctionSymbolIds,
      );
    }
    const callbackInvocation = getSynchronousCallbackInvocation(referenceRoot, context);
    return Boolean(
      callbackInvocation &&
      isNodeExecutedFromDeferredCallback(
        callbackInvocation,
        snapshotOwner,
        context,
        visitedFunctionSymbolIds,
      ),
    );
  });
};

const isFunctionExecutedAsDeferredCallback = (
  functionNode: EsTreeNode,
  snapshotOwner: EsTreeNode,
  context: RuleContext,
  visitedFunctionSymbolIds: Set<number>,
): boolean => {
  const functionRoot = findTransparentExpressionRoot(functionNode);
  if (isDeferredCallbackValue(functionRoot, context)) return true;
  const synchronousInvocation = getSynchronousCallbackInvocation(functionRoot, context);
  if (synchronousInvocation) {
    return isNodeExecutedFromDeferredCallback(
      synchronousInvocation,
      snapshotOwner,
      context,
      visitedFunctionSymbolIds,
    );
  }
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  return Boolean(
    symbol &&
    isSymbolExecutedAsDeferredCallback(symbol, snapshotOwner, context, visitedFunctionSymbolIds),
  );
};

const isDirectSnapshotAliasInitializer = (identifier: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(identifier);
  const parent = expressionRoot.parent;
  return Boolean(
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === expressionRoot &&
    isNodeOfType(parent.id, "Identifier"),
  );
};

export const valtioNoSnapshotInCallback = defineRule({
  id: "valtio-no-snapshot-in-callback",
  title: "Valtio snapshot read in a callback",
  severity: "warn",
  requires: ["valtio", "valtio:1"],
  recommendation:
    "Read from the original Valtio proxy inside callbacks. `useSnapshot()` results are for render reads; callback reads can become tracked render dependencies and cause extra re-renders.",
  create: (context: RuleContext) => ({
    Identifier(node: EsTreeNodeOfType<"Identifier">) {
      const reference = context.scopes.referenceFor(node);
      if (!reference || reference.flag === "write") return;
      const snapshotOriginCall = getSnapshotOriginCall(node, context);
      if (!snapshotOriginCall || isDirectSnapshotAliasInitializer(node)) return;
      const snapshotOwner = findEnclosingFunction(snapshotOriginCall);
      if (!snapshotOwner) return;
      const referenceOwner = findEnclosingFunction(node);
      if (!referenceOwner || referenceOwner === snapshotOwner) return;
      if (
        !isFunctionExecutedAsDeferredCallback(referenceOwner, snapshotOwner, context, new Set())
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This callback reads a Valtio snapshot. Read the original proxy instead so callback-only fields do not become tracked render dependencies.",
      });
    },
  }),
});
