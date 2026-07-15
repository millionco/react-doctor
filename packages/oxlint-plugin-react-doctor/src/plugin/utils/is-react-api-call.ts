import { REACT_RUNTIME_MODULE_SOURCES } from "../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface ReactApiCallOptions {
  allowGlobalReactNamespace?: boolean;
  allowUnboundBareCalls?: boolean;
  resolveConditionalAliases?: boolean;
  resolveNamedAliases?: boolean;
}

const includesApiName = (apiNames: string | ReadonlySet<string>, apiName: string): boolean =>
  typeof apiNames === "string" ? apiNames === apiName : apiNames.has(apiName);

export const isImportedFromReact = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "import") return false;
  const importDeclaration = symbol.declarationNode.parent;
  return Boolean(
    importDeclaration &&
    isNodeOfType(importDeclaration, "ImportDeclaration") &&
    typeof importDeclaration.source.value === "string" &&
    REACT_RUNTIME_MODULE_SOURCES.has(importDeclaration.source.value),
  );
};

const isNamedReactApiImport = (
  identifier: EsTreeNode,
  apiNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
  resolveAliases: boolean,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = resolveAliases
    ? resolveConstIdentifierAlias(identifier, scopes)
    : scopes.symbolFor(identifier);
  if (!symbol || !isImportedFromReact(symbol)) return false;
  const importedName = getImportedName(symbol.declarationNode);
  return Boolean(importedName && includesApiName(apiNames, importedName));
};

export const isReactNamespaceImport = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = resolveConstIdentifierAlias(identifier, scopes);
  if (!symbol || !isImportedFromReact(symbol)) return false;
  return (
    isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
    getImportedName(symbol.declarationNode) === "default"
  );
};

const isReactNamespaceReceiver = (
  receiver: EsTreeNode,
  scopes: ScopeAnalysis,
  options: ReactApiCallOptions,
): boolean => {
  if (!isNodeOfType(receiver, "Identifier")) return false;
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
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator")
  ) {
    return false;
  }
  const pattern = symbol.declarationNode.id;
  if (!isNodeOfType(pattern, "ObjectPattern")) return false;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property") || property.value !== symbol.bindingIdentifier) {
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
  options: ReactApiCallOptions = {},
): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  return isReactApiCallee(node.callee, apiNames, scopes, options, new Set());
};

const isReactApiCallee = (
  rawCallee: EsTreeNode,
  apiNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
  options: ReactApiCallOptions,
  visitedSymbolIds: Set<number>,
): boolean => {
  const callee = stripParenExpression(rawCallee);
  if (options.resolveConditionalAliases && isNodeOfType(callee, "ConditionalExpression")) {
    return (
      isReactApiCallee(callee.consequent, apiNames, scopes, options, new Set(visitedSymbolIds)) &&
      isReactApiCallee(callee.alternate, apiNames, scopes, options, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(callee, "Identifier")) {
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
      if (symbol?.kind === "const" && symbol.initializer && !visitedSymbolIds.has(symbol.id)) {
        visitedSymbolIds.add(symbol.id);
        return isReactApiCallee(symbol.initializer, apiNames, scopes, options, visitedSymbolIds);
      }
    }
    return Boolean(
      options.allowUnboundBareCalls &&
      includesApiName(apiNames, callee.name) &&
      scopes.isGlobalReference(callee),
    );
  }
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !includesApiName(apiNames, getStaticPropertyName(callee) ?? "")
  ) {
    return false;
  }
  return isReactNamespaceReceiver(stripParenExpression(callee.object), scopes, options);
};
