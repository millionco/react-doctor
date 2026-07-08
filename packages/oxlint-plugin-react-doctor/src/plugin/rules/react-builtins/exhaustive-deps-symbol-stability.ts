import { closureCaptures } from "../../semantic/closure-captures.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  getHookName,
  isOutsideAllFunctions,
  unwrapExpression,
} from "./exhaustive-deps-low-level.js";

/**
 * Symbol-stability helpers consumed by the `exhaustive-deps` rule.
 *
 * One cohesive concept: "given a captured symbol, is its value
 * structurally stable across re-renders (and therefore unnecessary
 * in a deps array)?". The rule reads `symbolHasStableValue` /
 * `symbolHasStableHookOrigin` / `symbolHasUseEffectEventOrigin` /
 * `isRecursiveInitializerCapture` at multiple sites — extracting
 * them lets the rule body stay focused on the diff-the-captured-vs-
 * declared logic.
 *
 * Low-level helpers (`unwrapExpression`, `getHookName`,
 * `isOutsideAllFunctions`) live in
 * `./exhaustive-deps-low-level.ts` so both this module and the main
 * rule can import them without a circular dependency.
 */

// Userland wrapper hooks whose documented contract is "returns a
// callback with a stable identity that always invokes the latest
// closure" (ahooks' useMemoizedFn/usePersistFn, MUI's useEventCallback,
// Radix's useCallbackRef, the useEvent RFC, and the common
// useStableCallback/useLatestCallback names). Their return value can
// never be stale, so it doesn't belong in a deps array.
const STABLE_IDENTITY_WRAPPER_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useEventCallback",
  "useStableCallback",
  "useMemoizedFn",
  "usePersistFn",
  "useLatestCallback",
  "useCallbackRef",
  "useEvent",
]);

/**
 * True for symbols whose returned value (or destructured pieces) are
 * stable across re-renders and don't need to live in deps arrays:
 *   - useState's setter (`setX`)
 *   - useReducer's dispatch
 *   - useRef's ref object
 *   - useEffectEvent's return value (and userland stable-identity
 *     wrappers like useEventCallback / useMemoizedFn)
 *   - primitive-literal local consts (the value never changes
 *     between renders unless the literal does)
 */
export const symbolHasStableHookOrigin = (symbol: SymbolDescriptor): boolean => {
  if (symbol.references.some((reference) => reference.flag !== "read")) return false;
  // We need the binding's parent context. The symbol's
  // declarationNode is the VariableDeclarator (when destructured) or
  // the binding identifier itself.
  let declarator: EsTreeNode | null | undefined = symbol.declarationNode;
  while (declarator && declarator.type !== "VariableDeclarator") {
    declarator = declarator.parent ?? null;
  }
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  const initializerRaw = declarator.init;
  if (!initializerRaw) return false;
  const initializer = unwrapExpression(initializerRaw);

  // Primitive literal initializer of a `const` binding — the value
  // cannot change between renders, so the captured reference is
  // structurally stable for dep-array purposes. `let` / `var` could
  // be reassigned and don't qualify.
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
  // useRef returns a stable ref; the binding itself is the ref.
  if (initializerHookName === "useRef") return true;
  // useEffectEvent returns a stable callback (React's RFC).
  if (initializerHookName === "useEffectEvent") return true;
  if (STABLE_IDENTITY_WRAPPER_HOOK_NAMES.has(initializerHookName)) return true;
  // useState / useReducer: the SECOND destructure element (setter /
  // dispatch) is stable; the first is mutable.
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

export const isRecursiveInitializerCapture = (
  symbol: SymbolDescriptor,
  callback: EsTreeNode,
): boolean => {
  const initializer = symbol.initializer;
  return Boolean(initializer && isAstDescendant(callback, initializer));
};

const MEMOIZING_HOOK_NAMES: ReadonlySet<string> = new Set(["useCallback", "useMemo"]);

// `const fn = useCallback(..., [])` (or useMemo, or with deps that are
// all themselves stable) returns the exact same value on every render,
// so the binding can never be stale. Any staleness INSIDE the frozen
// closure is reported at the useCallback call itself, not at consumers.
const symbolHasStableMemoizedOrigin = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  if (visitedSymbolIds.has(symbol.id)) return true;
  if (symbol.references.some((reference) => reference.flag !== "read")) return false;
  let declarator: EsTreeNode | null | undefined = symbol.declarationNode;
  while (declarator && declarator.type !== "VariableDeclarator") {
    declarator = declarator.parent ?? null;
  }
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (declarator.id !== symbol.bindingIdentifier) return false;
  if (!declarator.init) return false;
  const initializer = unwrapExpression(declarator.init);
  if (!isNodeOfType(initializer, "CallExpression")) return false;
  const initializerHookName = getHookName(initializer.callee);
  if (!initializerHookName || !MEMOIZING_HOOK_NAMES.has(initializerHookName)) return false;
  const depsArgument = initializer.arguments[1];
  if (!depsArgument || !isAstNode(depsArgument)) return false;
  const strippedDepsArgument = unwrapExpression(depsArgument);
  if (!isNodeOfType(strippedDepsArgument, "ArrayExpression")) return false;
  visitedSymbolIds.add(symbol.id);
  const isStableDepElement = (element: EsTreeNode): boolean => {
    const strippedElement = unwrapExpression(element);
    if (isNodeOfType(strippedElement, "Literal")) return true;
    if (!isNodeOfType(strippedElement, "Identifier")) return false;
    const depSymbol = scopes.symbolFor(strippedElement);
    if (!depSymbol) return false;
    if (isOutsideAllFunctions(depSymbol)) return true;
    return symbolHasStableValue(depSymbol, scopes, visitedSymbolIds);
  };
  const areAllDepElementsStable = strippedDepsArgument.elements.every(
    (element) => element !== null && isStableDepElement(element as EsTreeNode),
  );
  // `visitedSymbolIds` entries mean "assume stable" only while the
  // symbol's own check is still in progress — a failed check must
  // remove itself or a later sibling lookup would read the leftover
  // entry as a proven-stable cycle.
  if (!areAllDepElementsStable) visitedSymbolIds.delete(symbol.id);
  return areAllDepElementsStable;
};

const getObjectPropertyValue = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  propertyName: string,
): EsTreeNode | null => {
  for (const property of objectExpression.properties) {
    const propertyNode = property as EsTreeNode;
    if (!isNodeOfType(propertyNode, "Property")) return null;
    if (propertyNode.computed) continue;
    const key = propertyNode.key as EsTreeNode;
    const keyName = isNodeOfType(key, "Identifier")
      ? key.name
      : isNodeOfType(key, "Literal") && typeof key.value === "string"
        ? key.value
        : null;
    if (keyName === propertyName) return unwrapExpression(propertyNode.value as EsTreeNode);
  }
  return null;
};

// `const refs = { slider: useRef(null) }` re-creates the container each
// render, but each property holds the SAME ref object (hook-call order
// guarantees it), so a captured `refs.slider` path can never be stale.
export const isStableRefContainerCapture = (symbol: SymbolDescriptor, depKey: string): boolean => {
  if (symbol.kind !== "const") return false;
  if (!depKey.startsWith(`${symbol.name}.`)) return false;
  if (symbol.references.some((reference) => reference.flag !== "read")) return false;
  const initializer = symbol.initializer ? unwrapExpression(symbol.initializer) : null;
  if (!initializer || !isNodeOfType(initializer, "ObjectExpression")) return false;
  const propertyPathSegments = depKey.slice(symbol.name.length + 1).split(".");
  let currentValue: EsTreeNode = initializer;
  for (const segmentName of propertyPathSegments) {
    if (!isNodeOfType(currentValue, "ObjectExpression")) return false;
    const propertyValue = getObjectPropertyValue(currentValue, segmentName);
    if (!propertyValue) return false;
    currentValue = propertyValue;
  }
  return (
    isNodeOfType(currentValue, "CallExpression") && getHookName(currentValue.callee) === "useRef"
  );
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
    // Entries in `visitedSymbolIds` mean "assume stable" only while their own
    // check is in progress — a failed check must remove itself, or a sibling
    // check would read the leftover entry as a proven-stable cycle.
    visitedSymbolIds.delete(symbol.id);
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
  symbolHasStableFunctionOrigin(symbol, scopes, visitedSymbolIds) ||
  symbolHasStableMemoizedOrigin(symbol, scopes, visitedSymbolIds);
