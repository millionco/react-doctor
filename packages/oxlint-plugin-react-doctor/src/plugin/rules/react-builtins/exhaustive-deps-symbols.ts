import { closureCaptures } from "../../semantic/closure-captures.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getHookName } from "./exhaustive-deps-helpers.js";
import { unwrapExpression } from "./exhaustive-deps-expression.js";

export const symbolHasStableHookOrigin = (symbol: SymbolDescriptor): boolean => {
  if (symbol.references.some((reference) => reference.flag !== "read")) return false;
  let declarator: EsTreeNode | null | undefined = symbol.declarationNode;
  while (declarator && declarator.type !== "VariableDeclarator") {
    declarator = declarator.parent ?? null;
  }
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  const initializerRaw = declarator.init;
  if (!initializerRaw) return false;
  const initializer = unwrapExpression(initializerRaw);

  if (symbol.kind === "const") {
    if (
      isNodeOfType(initializer, "Literal") &&
      (initializer.value === null ||
        typeof initializer.value === "number" ||
        typeof initializer.value === "string" ||
        typeof initializer.value === "boolean")
    ) {
      return true;
    }
    if (
      isNodeOfType(initializer, "TemplateLiteral") &&
      getStaticTemplateLiteralValue(initializer) !== null
    ) {
      return true;
    }
  }

  if (!isNodeOfType(initializer, "CallExpression")) return false;
  const initializerHookName = getHookName(initializer.callee);
  if (!initializerHookName) return false;
  if (initializerHookName === "useRef") return true;
  if (initializerHookName === "useEffectEvent") return true;
  if (
    initializerHookName === "useState" ||
    initializerHookName === "useReducer" ||
    initializerHookName === "useActionState" ||
    initializerHookName === "useTransition"
  ) {
    if (!isNodeOfType(declarator.id, "ArrayPattern")) return false;
    const STABLE_RETURN_INDEX = 1;
    const elements = declarator.id.elements;
    const stableElement = elements[STABLE_RETURN_INDEX];
    if (!stableElement) return false;
    const innerBinding = isNodeOfType(stableElement as EsTreeNode, "AssignmentPattern")
      ? (stableElement as EsTreeNodeOfType<"AssignmentPattern">).left
      : (stableElement as EsTreeNode);
    return isNodeOfType(innerBinding, "Identifier") && symbol.bindingIdentifier === innerBinding;
  }
  return false;
};

export const symbolHasUseEffectEventOrigin = (symbol: SymbolDescriptor): boolean => {
  const initializer = symbol.initializer ? unwrapExpression(symbol.initializer) : null;
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  return getHookName(initializer.callee) === "useEffectEvent";
};

export const getFunctionValueNode = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (symbol.kind === "function" && isNodeOfType(symbol.declarationNode, "FunctionDeclaration")) {
    return symbol.declarationNode;
  }
  const initializer = symbol.initializer ? unwrapExpression(symbol.initializer) : null;
  if (
    initializer &&
    (isNodeOfType(initializer, "FunctionExpression") ||
      isNodeOfType(initializer, "ArrowFunctionExpression"))
  ) {
    return initializer;
  }
  return null;
};

const isAstDescendant = (inner: EsTreeNode, outer: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = inner;
  while (current) {
    if (current === outer) return true;
    current = current.parent ?? null;
  }
  return false;
};

export const isRecursiveInitializerCapture = (
  symbol: SymbolDescriptor,
  callback: EsTreeNode,
): boolean => {
  const initializer = symbol.initializer;
  return Boolean(initializer && isAstDescendant(callback, initializer));
};

const FUNCTION_SCOPE_KINDS: ReadonlySet<string> = new Set(["function", "arrow-function", "method"]);

export const isOutsideAllFunctions = (symbol: SymbolDescriptor): boolean => {
  let scope: SymbolDescriptor["scope"] | null = symbol.scope;
  while (scope) {
    if (FUNCTION_SCOPE_KINDS.has(scope.kind)) return false;
    if (scope.kind === "module") return true;
    scope = scope.parent ?? null;
  }
  return true;
};

const symbolHasStableFunctionOrigin = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (visitedSymbolIds.has(symbol.id)) return true;
  const functionNode = getFunctionValueNode(symbol);
  if (!functionNode) return false;
  visitedSymbolIds.add(symbol.id);
  for (const reference of closureCaptures(functionNode, scopes)) {
    const capturedSymbol = reference.resolvedSymbol;
    if (!capturedSymbol) continue;
    if (capturedSymbol.id === symbol.id) continue;
    if (isOutsideAllFunctions(capturedSymbol)) continue;
    if (symbolHasStableValue(capturedSymbol, scopes, visitedSymbolIds)) continue;
    return false;
  }
  return true;
};

export const symbolHasStableValue = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean =>
  symbolHasStableHookOrigin(symbol) ||
  symbolHasStableFunctionOrigin(symbol, scopes, visitedSymbolIds);
