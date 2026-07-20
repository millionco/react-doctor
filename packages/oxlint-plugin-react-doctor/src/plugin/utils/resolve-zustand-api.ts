import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface ZustandApiBinding {
  readonly apiName:
    | "combine"
    | "create"
    | "createJSONStorage"
    | "createStore"
    | "createWithEqualityFn"
    | "devtools"
    | "immer"
    | "persist"
    | "redux"
    | "shallow"
    | "subscribeWithSelector"
    | "useShallow"
    | "useStore"
    | "useStoreWithEqualityFn";
  readonly moduleSource: string;
}

export interface ZustandStoreCreator {
  readonly creatorFunction:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionDeclaration">
    | EsTreeNodeOfType<"FunctionExpression">;
  readonly factoryApiName: "create" | "createStore" | "createWithEqualityFn";
  readonly middlewareNames: ReadonlySet<ZustandApiBinding["apiName"]>;
}

export interface ZustandStoreFactoryCall {
  readonly callExpression: EsTreeNodeOfType<"CallExpression">;
  readonly creatorArgument: EsTreeNode;
  readonly factoryApiName: "create" | "createStore" | "createWithEqualityFn";
}

const ZUSTAND_APIS_BY_MODULE = new Map<string, ReadonlySet<ZustandApiBinding["apiName"]>>([
  ["zustand", new Set(["create", "createStore", "useStore"])],
  ["zustand/vanilla", new Set(["createStore"])],
  ["zustand/react", new Set(["useStore"])],
  ["zustand/traditional", new Set(["createWithEqualityFn", "useStoreWithEqualityFn"])],
  ["zustand/shallow", new Set(["shallow", "useShallow"])],
  ["zustand/react/shallow", new Set(["useShallow"])],
  [
    "zustand/middleware",
    new Set([
      "combine",
      "createJSONStorage",
      "devtools",
      "persist",
      "redux",
      "subscribeWithSelector",
    ]),
  ],
  ["zustand/middleware/immer", new Set(["immer"])],
]);

const STATE_CREATOR_MIDDLEWARE_ARGUMENT_INDEX = new Map<ZustandApiBinding["apiName"], number>([
  ["combine", 1],
  ["devtools", 0],
  ["immer", 0],
  ["persist", 0],
  ["subscribeWithSelector", 0],
]);

const toZustandApiName = (value: string): ZustandApiBinding["apiName"] | null => {
  switch (value) {
    case "combine":
    case "create":
    case "createJSONStorage":
    case "createStore":
    case "createWithEqualityFn":
    case "devtools":
    case "immer":
    case "persist":
    case "redux":
    case "shallow":
    case "subscribeWithSelector":
    case "useShallow":
    case "useStore":
    case "useStoreWithEqualityFn":
      return value;
    default:
      return null;
  }
};

const getImportSource = (symbol: SymbolDescriptor): string | null => {
  const declaration = getImportDeclarationForSymbol(symbol);
  if (
    !declaration ||
    isTypeOnlyImport(declaration) ||
    (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type")
  ) {
    return null;
  }
  return typeof declaration.source.value === "string" ? declaration.source.value : null;
};

const bindingFromImportSymbol = (symbol: SymbolDescriptor): ZustandApiBinding | null => {
  const moduleSource = getImportSource(symbol);
  const supportedApiNames = moduleSource ? ZUSTAND_APIS_BY_MODULE.get(moduleSource) : null;
  if (!moduleSource || !supportedApiNames) return null;
  if (
    moduleSource === "zustand" &&
    isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
  ) {
    return { apiName: "create", moduleSource };
  }
  const importedName = getImportedName(symbol.declarationNode);
  const apiName = importedName ? toZustandApiName(importedName) : null;
  return apiName && supportedApiNames.has(apiName) ? { apiName, moduleSource } : null;
};

const namespaceImportSource = (expression: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(expression, scopes);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) return null;
  return getImportSource(symbol);
};

export const resolveZustandApiBinding = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): ZustandApiBinding | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(candidate, scopes);
    if (!symbol) return null;
    if (symbol.kind === "import") return bindingFromImportSymbol(symbol);
    if (symbol.kind !== "const" || !symbol.initializer) return null;
    return resolveZustandApiBinding(symbol.initializer, scopes);
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(candidate);
  const moduleSource = namespaceImportSource(stripParenExpression(candidate.object), scopes);
  const supportedApiNames = moduleSource ? ZUSTAND_APIS_BY_MODULE.get(moduleSource) : null;
  const apiName = propertyName ? toZustandApiName(propertyName) : null;
  return apiName && moduleSource && supportedApiNames?.has(apiName)
    ? { apiName, moduleSource }
    : null;
};

const resolveStateCreator = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  middlewareNames: Set<ZustandApiBinding["apiName"]>,
  visitedExpressions: Set<EsTreeNode> = new Set(),
): ZustandStoreCreator["creatorFunction"] | null => {
  const candidate = stripParenExpression(expression);
  if (visitedExpressions.has(candidate)) return null;
  visitedExpressions.add(candidate);
  const creatorFunction = resolveExactLocalFunction(expression, scopes);
  if (isFunctionLike(creatorFunction)) return creatorFunction;
  if (!isNodeOfType(candidate, "CallExpression")) return null;
  const middleware = resolveZustandApiBinding(candidate.callee, scopes);
  const creatorArgumentIndex = middleware
    ? STATE_CREATOR_MIDDLEWARE_ARGUMENT_INDEX.get(middleware.apiName)
    : null;
  if (!middleware || creatorArgumentIndex === undefined || creatorArgumentIndex === null) {
    return null;
  }
  const creatorArgument = candidate.arguments[creatorArgumentIndex];
  if (!creatorArgument || isNodeOfType(creatorArgument, "SpreadElement")) return null;
  middlewareNames.add(middleware.apiName);
  return resolveStateCreator(creatorArgument, scopes, middlewareNames, visitedExpressions);
};

const isStoreFactoryApi = (
  binding: ZustandApiBinding | null,
): binding is ZustandApiBinding & {
  apiName: "create" | "createStore" | "createWithEqualityFn";
} =>
  binding?.apiName === "create" ||
  binding?.apiName === "createStore" ||
  binding?.apiName === "createWithEqualityFn";

const resolveCurriedStoreFactoryBinding = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): ZustandApiBinding | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(candidate, scopes);
    if (symbol?.kind !== "const" || !symbol.initializer) return null;
    return resolveCurriedStoreFactoryBinding(symbol.initializer, scopes);
  }
  if (!isNodeOfType(candidate, "CallExpression") || candidate.arguments.length > 0) return null;
  const factoryBinding = resolveZustandApiBinding(candidate.callee, scopes);
  return isStoreFactoryApi(factoryBinding) ? factoryBinding : null;
};

export const resolveZustandStoreCreator = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): ZustandStoreCreator | null => {
  const factoryCall = resolveZustandStoreFactoryCall(callExpression, scopes);
  if (!factoryCall) return null;
  const middlewareNames = new Set<ZustandApiBinding["apiName"]>();
  const creatorFunction = resolveStateCreator(factoryCall.creatorArgument, scopes, middlewareNames);
  if (!creatorFunction) return null;
  return {
    creatorFunction,
    factoryApiName: factoryCall.factoryApiName,
    middlewareNames,
  };
};

export const resolveZustandStoreFactoryCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): ZustandStoreFactoryCall | null => {
  let factoryBinding = resolveZustandApiBinding(callExpression.callee, scopes);
  if (!isStoreFactoryApi(factoryBinding)) {
    factoryBinding = resolveCurriedStoreFactoryBinding(callExpression.callee, scopes);
    if (!isStoreFactoryApi(factoryBinding)) return null;
  }
  const creatorArgument = callExpression.arguments[0];
  if (!creatorArgument || isNodeOfType(creatorArgument, "SpreadElement")) return null;
  return {
    callExpression,
    creatorArgument,
    factoryApiName: factoryBinding.apiName,
  };
};
