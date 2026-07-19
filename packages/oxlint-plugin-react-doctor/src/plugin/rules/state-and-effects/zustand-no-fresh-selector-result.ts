import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  getImportedNameFromModule,
  isDefaultImportFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { resolveFreshRenderValue } from "../../utils/resolve-fresh-render-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

interface FreshSelectorResult {
  readonly kind: "array" | "function" | "instance" | "object";
  readonly node: EsTreeNode;
}

interface ZustandBoundStore {
  readonly hasDefaultEquality: boolean;
  readonly supportsEqualityArgument: boolean;
}

interface ZustandSelectorCall {
  readonly selector: EsTreeNode;
}

interface ZustandApiBinding {
  readonly apiName:
    | "create"
    | "createWithEqualityFn"
    | "useShallow"
    | "useStore"
    | "useStoreWithEqualityFn";
}

const ALLOCATING_ARRAY_METHODS = new Set([
  "filter",
  "flat",
  "flatMap",
  "map",
  "toReversed",
  "toSorted",
  "toSpliced",
  "with",
]);

const SAME_REFERENCE_ARRAY_METHODS = new Set(["reverse", "sort"]);

const ALLOCATING_NAMESPACE_METHODS = new Map<string, ReadonlySet<string>>([
  ["Array", new Set(["from", "of"])],
  ["Object", new Set(["create", "entries", "fromEntries", "keys", "values"])],
]);

const ZUSTAND_CORE_API_NAMES: ReadonlySet<ZustandApiBinding["apiName"]> = new Set([
  "create",
  "useStore",
]);

const ZUSTAND_TRADITIONAL_API_NAMES: ReadonlySet<ZustandApiBinding["apiName"]> = new Set([
  "createWithEqualityFn",
  "useStoreWithEqualityFn",
]);

const ZUSTAND_SHALLOW_API_NAMES: ReadonlySet<ZustandApiBinding["apiName"]> = new Set([
  "useShallow",
]);

const toZustandApiName = (importedName: string): ZustandApiBinding["apiName"] | null => {
  switch (importedName) {
    case "create":
    case "createWithEqualityFn":
    case "useShallow":
    case "useStore":
    case "useStoreWithEqualityFn":
      return importedName;
    default:
      return null;
  }
};

const isNullishEqualityArgument = (argument: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(argument);
  return (
    (isNodeOfType(candidate, "Identifier") &&
      candidate.name === "undefined" &&
      scopes.isGlobalReference(candidate)) ||
    (isNodeOfType(candidate, "Literal") && candidate.value === null) ||
    (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "void")
  );
};

const hasExplicitEqualityArgument = (
  argumentsList: ReadonlyArray<EsTreeNode>,
  equalityArgumentIndex: number,
  scopes: ScopeAnalysis,
): boolean => {
  const equalityArgument = argumentsList[equalityArgumentIndex];
  if (!equalityArgument) return false;
  if (isNodeOfType(equalityArgument, "SpreadElement")) return true;
  return !isNullishEqualityArgument(equalityArgument, scopes);
};

const getNamedImportApi = (
  identifier: EsTreeNodeOfType<"Identifier">,
  moduleSource: string,
  supportedApiNames: ReadonlySet<ZustandApiBinding["apiName"]>,
): ZustandApiBinding | null => {
  const importedName = getImportedNameFromModule(identifier, identifier.name, moduleSource);
  if (!importedName) return null;
  const apiName = toZustandApiName(importedName);
  return apiName && supportedApiNames.has(apiName) ? { apiName } : null;
};

const resolveDirectZustandApiBinding = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): ZustandApiBinding | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    if (scopes.symbolFor(candidate)?.kind !== "import") return null;
    return (
      getNamedImportApi(candidate, "zustand", ZUSTAND_CORE_API_NAMES) ??
      getNamedImportApi(candidate, "zustand/traditional", ZUSTAND_TRADITIONAL_API_NAMES) ??
      getNamedImportApi(candidate, "zustand/react/shallow", ZUSTAND_SHALLOW_API_NAMES) ??
      getNamedImportApi(candidate, "zustand/shallow", ZUSTAND_SHALLOW_API_NAMES) ??
      (isDefaultImportFromModule(candidate, candidate.name, "zustand")
        ? { apiName: "create" }
        : null)
    );
  }

  if (!isNodeOfType(candidate, "MemberExpression")) return null;
  const namespaceIdentifier = stripParenExpression(candidate.object);
  const propertyName = getStaticPropertyName(candidate);
  if (!isNodeOfType(namespaceIdentifier, "Identifier") || !propertyName) return null;
  if (scopes.symbolFor(namespaceIdentifier)?.kind !== "import") return null;

  if (
    isNamespaceImportFromModule(namespaceIdentifier, namespaceIdentifier.name, "zustand") &&
    (propertyName === "create" || propertyName === "useStore")
  ) {
    return { apiName: propertyName };
  }
  if (
    isNamespaceImportFromModule(
      namespaceIdentifier,
      namespaceIdentifier.name,
      "zustand/traditional",
    ) &&
    (propertyName === "createWithEqualityFn" || propertyName === "useStoreWithEqualityFn")
  ) {
    return { apiName: propertyName };
  }
  if (
    (isNamespaceImportFromModule(
      namespaceIdentifier,
      namespaceIdentifier.name,
      "zustand/react/shallow",
    ) ||
      isNamespaceImportFromModule(
        namespaceIdentifier,
        namespaceIdentifier.name,
        "zustand/shallow",
      )) &&
    propertyName === "useShallow"
  ) {
    return { apiName: propertyName };
  }
  return null;
};

const resolveZustandApiBinding = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): ZustandApiBinding | null => {
  const directBinding = resolveDirectZustandApiBinding(expression, scopes);
  if (directBinding) return directBinding;

  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveZustandApiBinding(symbol.initializer, scopes, visitedSymbolIds);
};

const resolveZustandStoreCreation = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): ZustandBoundStore | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "CallExpression")) return null;

  const directFactory = resolveZustandApiBinding(candidate.callee, scopes);
  if (directFactory?.apiName === "create") {
    return { hasDefaultEquality: false, supportsEqualityArgument: false };
  }
  if (directFactory?.apiName === "createWithEqualityFn") {
    return {
      hasDefaultEquality: hasExplicitEqualityArgument(candidate.arguments, 1, scopes),
      supportsEqualityArgument: true,
    };
  }

  const curriedFactoryCall = stripParenExpression(candidate.callee);
  if (!isNodeOfType(curriedFactoryCall, "CallExpression")) return null;
  const curriedFactory = resolveZustandApiBinding(curriedFactoryCall.callee, scopes);
  if (curriedFactory?.apiName === "create") {
    return { hasDefaultEquality: false, supportsEqualityArgument: false };
  }
  if (curriedFactory?.apiName === "createWithEqualityFn") {
    return {
      hasDefaultEquality: hasExplicitEqualityArgument(candidate.arguments, 1, scopes),
      supportsEqualityArgument: true,
    };
  }
  return null;
};

const resolveZustandBoundStore = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): ZustandBoundStore | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return (
    resolveZustandStoreCreation(symbol.initializer, scopes) ??
    resolveZustandBoundStore(symbol.initializer, scopes, visitedSymbolIds)
  );
};

const getZustandSelectorCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): ZustandSelectorCall | null => {
  const apiBinding = resolveZustandApiBinding(callExpression.callee, scopes);
  if (apiBinding?.apiName === "useStore" || apiBinding?.apiName === "useStoreWithEqualityFn") {
    const selector = callExpression.arguments[1];
    if (!selector || isNodeOfType(selector, "SpreadElement")) return null;
    if (
      apiBinding.apiName === "useStoreWithEqualityFn" &&
      hasExplicitEqualityArgument(callExpression.arguments, 2, scopes)
    ) {
      return null;
    }
    return { selector };
  }

  const boundStore = resolveZustandBoundStore(callExpression.callee, scopes);
  const selector = callExpression.arguments[0];
  if (!boundStore || !selector || isNodeOfType(selector, "SpreadElement")) return null;
  if (
    boundStore.hasDefaultEquality ||
    (boundStore.supportsEqualityArgument &&
      hasExplicitEqualityArgument(callExpression.arguments, 1, scopes))
  ) {
    return null;
  }
  return { selector };
};

const isUseShallowCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => resolveZustandApiBinding(callExpression.callee, scopes)?.apiName === "useShallow";

const resolveSelectorFunction = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (isFunctionLike(candidate)) return candidate;

  if (isNodeOfType(candidate, "CallExpression")) {
    if (isUseShallowCall(candidate, scopes)) return null;
    if (
      !isReactApiCall(candidate, "useCallback", scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      })
    ) {
      return null;
    }
    const callback = candidate.arguments[0];
    if (!callback || isNodeOfType(callback, "SpreadElement")) return null;
    return resolveSelectorFunction(callback, scopes, visitedSymbolIds);
  }

  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (
    !symbol ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  if (symbol.kind === "function" && isFunctionLike(symbol.declarationNode)) {
    return symbol.declarationNode;
  }
  if (symbol.kind !== "const" || !symbol.initializer) return null;
  visitedSymbolIds.add(symbol.id);
  return resolveSelectorFunction(symbol.initializer, scopes, visitedSymbolIds);
};

const freshResultFromAllocatingCall = (
  expression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): FreshSelectorResult | null => {
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  if (!methodName) return null;
  const receiver = stripParenExpression(callee.object);

  if (isNodeOfType(receiver, "Identifier") && scopes.isGlobalReference(receiver)) {
    const allocatingMethods = ALLOCATING_NAMESPACE_METHODS.get(receiver.name);
    if (allocatingMethods?.has(methodName)) {
      return { kind: receiver.name === "Object" ? "object" : "array", node: expression };
    }
    if (receiver.name === "Object" && methodName === "assign") {
      const target = expression.arguments[0];
      if (!target || isNodeOfType(target, "SpreadElement")) return null;
      const freshTarget = resolveFreshSelectorResult(target, scopes, new Set(visitedSymbolIds));
      return freshTarget ? { kind: freshTarget.kind, node: expression } : null;
    }
  }

  if (ALLOCATING_ARRAY_METHODS.has(methodName)) {
    return { kind: "array", node: expression };
  }
  if (!SAME_REFERENCE_ARRAY_METHODS.has(methodName)) return null;
  const freshReceiver = resolveFreshSelectorResult(receiver, scopes, new Set(visitedSymbolIds));
  return freshReceiver ? { kind: "array", node: expression } : null;
};

const resolveFreshSelectorResult = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): FreshSelectorResult | null => {
  const freshRenderValue = resolveFreshRenderValue(expression, scopes);
  if (
    freshRenderValue?.kind === "array" ||
    freshRenderValue?.kind === "function" ||
    freshRenderValue?.kind === "instance" ||
    freshRenderValue?.kind === "object"
  ) {
    return { kind: freshRenderValue.kind, node: expression };
  }

  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "CallExpression")) {
    return freshResultFromAllocatingCall(candidate, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      resolveFreshSelectorResult(candidate.consequent, scopes, new Set(visitedSymbolIds)) ??
      resolveFreshSelectorResult(candidate.alternate, scopes, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    if (candidate.operator === "&&") {
      return resolveFreshSelectorResult(candidate.right, scopes, visitedSymbolIds);
    }
    return (
      resolveFreshSelectorResult(candidate.left, scopes, new Set(visitedSymbolIds)) ??
      resolveFreshSelectorResult(candidate.right, scopes, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(candidate, "SequenceExpression")) {
    const returnedExpression = candidate.expressions[candidate.expressions.length - 1];
    return returnedExpression
      ? resolveFreshSelectorResult(returnedExpression, scopes, visitedSymbolIds)
      : null;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;

  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    symbol.scope.kind === "module" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveFreshSelectorResult(symbol.initializer, scopes, visitedSymbolIds);
};

const findFreshSelectorReturn = (
  selectorFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): FreshSelectorResult | null => {
  if (!isFunctionLike(selectorFunction) || !selectorFunction.body) return null;
  if (!isNodeOfType(selectorFunction.body, "BlockStatement")) {
    return resolveFreshSelectorResult(selectorFunction.body, scopes);
  }

  let freshResult: FreshSelectorResult | null = null;
  walkAst(selectorFunction.body, (candidate) => {
    if (freshResult) return false;
    if (candidate !== selectorFunction.body && isFunctionLike(candidate)) return false;
    if (!isNodeOfType(candidate, "ReturnStatement") || !candidate.argument) return;
    freshResult = resolveFreshSelectorResult(candidate.argument, scopes);
    return freshResult ? false : undefined;
  });
  return freshResult;
};

export const zustandNoFreshSelectorResult = defineRule({
  id: "zustand-no-fresh-selector-result",
  title: "Zustand selector returns a fresh value",
  severity: "error",
  category: "Performance",
  requires: ["zustand", "zustand:5"],
  recommendation:
    "Select a stable store field, split the selector, or wrap a collection selector with `useShallow`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const selectorCall = getZustandSelectorCall(node, context.scopes);
      if (!selectorCall) return;
      const selectorFunction = resolveSelectorFunction(selectorCall.selector, context.scopes);
      if (!selectorFunction) return;
      const freshResult = findFreshSelectorReturn(selectorFunction, context.scopes);
      if (!freshResult) return;

      context.report({
        node: freshResult.node,
        message:
          "This Zustand selector creates a new reference whenever the store is read, so Object.is never sees a stable snapshot and Zustand v5 can repeatedly render or hit maximum update depth. Select a stable field or use `useShallow`.",
      });
    },
  }),
});
