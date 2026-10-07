import { REACT_RUNTIME_MODULE_SOURCES } from "../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface ReactApiCallOptions {
  allowGlobalReactNamespace?: boolean;
  allowUnboundBareCalls?: boolean;
  resolveConditionalAliases?: boolean;
  resolveNamedAliases?: boolean;
}

interface ReactImportDescriptor {
  importedName: string | undefined;
  isReactImport: boolean;
}

const DEFAULT_REACT_API_CALL_OPTIONS: ReactApiCallOptions = {};
const reactImportDescriptorBySymbol = new WeakMap<SymbolDescriptor, ReactImportDescriptor>();

const includesApiName = (apiNames: string | ReadonlySet<string>, apiName: string): boolean =>
  typeof apiNames === "string" ? apiNames === apiName : apiNames.has(apiName);

const getReactImportDescriptor = (symbol: SymbolDescriptor): ReactImportDescriptor => {
  const cachedDescriptor = reactImportDescriptorBySymbol.get(symbol);
  if (cachedDescriptor) return cachedDescriptor;
  const importDeclaration = symbol.declarationNode.parent;
  const isReactImport = Boolean(
    symbol.kind === "import" &&
    importDeclaration &&
    importDeclaration.type === "ImportDeclaration" &&
    typeof importDeclaration.source.value === "string" &&
    REACT_RUNTIME_MODULE_SOURCES.has(importDeclaration.source.value),
  );
  const descriptor: ReactImportDescriptor = {
    importedName: isReactImport ? getImportedName(symbol.declarationNode) : undefined,
    isReactImport,
  };
  reactImportDescriptorBySymbol.set(symbol, descriptor);
  return descriptor;
};

export const isImportedFromReact = (symbol: SymbolDescriptor): boolean =>
  getReactImportDescriptor(symbol).isReactImport;

const isNamedReactApiImport = (
  identifier: EsTreeNode,
  apiNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
  resolveAliases: boolean,
): boolean => {
  if (identifier.type !== "Identifier") return false;
  const symbol = resolveAliases
    ? resolveConstIdentifierAlias(identifier, scopes)
    : scopes.symbolFor(identifier);
  if (!symbol) return false;
  const descriptor = getReactImportDescriptor(symbol);
  return Boolean(
    descriptor.isReactImport &&
    descriptor.importedName &&
    includesApiName(apiNames, descriptor.importedName),
  );
};

export const isReactNamespaceImport = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = resolveConstIdentifierAlias(identifier, scopes);
  if (!symbol) return false;
  const descriptor = getReactImportDescriptor(symbol);
  if (!descriptor.isReactImport) return false;
  return (
    symbol.declarationNode.type === "ImportDefaultSpecifier" ||
    symbol.declarationNode.type === "ImportNamespaceSpecifier" ||
    descriptor.importedName === "default"
  );
};

const isReactNamespaceReceiver = (
  receiver: EsTreeNode,
  scopes: ScopeAnalysis,
  options: ReactApiCallOptions,
): boolean => {
  if (receiver.type !== "Identifier") return false;
  if (isReactNamespaceImport(receiver, scopes)) return true;
  return Boolean(
    options.allowGlobalReactNamespace &&
    receiver.name === "React" &&
    scopes.isGlobalReference(receiver),
  );
};

const isDestructuredReactApiBinding = (
  identifier: EsTreeNode,
  apiNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
  options: ReactApiCallOptions,
): boolean => {
  const symbol = scopes.symbolFor(identifier);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !symbol.initializer ||
    symbol.declarationNode.type !== "VariableDeclarator"
  ) {
    return false;
  }
  const pattern = symbol.declarationNode.id;
  if (pattern.type !== "ObjectPattern") return false;
  for (const property of pattern.properties) {
    if (property.type !== "Property" || property.value !== symbol.bindingIdentifier) {
      continue;
    }
    const propertyName = getStaticPropertyKeyName(property);
    return Boolean(
      propertyName &&
      includesApiName(apiNames, propertyName) &&
      isReactNamespaceReceiver(stripParenExpression(symbol.initializer), scopes, options),
    );
  }
  return false;
};

export const isReactApiCall = (
  node: EsTreeNode,
  apiNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
  options: ReactApiCallOptions = DEFAULT_REACT_API_CALL_OPTIONS,
): boolean => {
  if (node.type !== "CallExpression") return false;
  return isReactApiCallee(node.callee, apiNames, scopes, options);
};

const isReactApiCallee = (
  rawCallee: EsTreeNode,
  apiNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
  options: ReactApiCallOptions,
  visitedSymbolIds?: Set<number>,
): boolean => {
  const callee = stripParenExpression(rawCallee);
  if (options.resolveConditionalAliases && callee.type === "ConditionalExpression") {
    return (
      isReactApiCallee(callee.consequent, apiNames, scopes, options, new Set(visitedSymbolIds)) &&
      isReactApiCallee(callee.alternate, apiNames, scopes, options, new Set(visitedSymbolIds))
    );
  }
  if (callee.type === "Identifier") {
    if (isNamedReactApiImport(callee, apiNames, scopes, Boolean(options.resolveNamedAliases))) {
      return true;
    }
    if (
      options.resolveNamedAliases &&
      isDestructuredReactApiBinding(callee, apiNames, scopes, options)
    ) {
      return true;
    }
    if (options.resolveConditionalAliases) {
      const symbol = scopes.symbolFor(callee);
      if (symbol?.kind === "const" && symbol.initializer && !visitedSymbolIds?.has(symbol.id)) {
        const nextVisitedSymbolIds = visitedSymbolIds ?? new Set<number>();
        nextVisitedSymbolIds.add(symbol.id);
        return isReactApiCallee(
          symbol.initializer,
          apiNames,
          scopes,
          options,
          nextVisitedSymbolIds,
        );
      }
    }
    return Boolean(
      options.allowUnboundBareCalls &&
      includesApiName(apiNames, callee.name) &&
      scopes.isGlobalReference(callee),
    );
  }
  if (
    callee.type !== "MemberExpression" ||
    !includesApiName(apiNames, getStaticPropertyName(callee) ?? "")
  ) {
    return false;
  }
  return isReactNamespaceReceiver(stripParenExpression(callee.object), scopes, options);
};
