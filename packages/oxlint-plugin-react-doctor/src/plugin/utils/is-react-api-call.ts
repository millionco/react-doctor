import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface ReactApiCallOptions {
  allowGlobalReactNamespace?: boolean;
  allowUnboundBareCalls?: boolean;
}

const includesApiName = (apiNames: string | ReadonlySet<string>, apiName: string): boolean =>
  typeof apiNames === "string" ? apiNames === apiName : apiNames.has(apiName);

const isImportedFromReact = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "import") return false;
  const importDeclaration = symbol.declarationNode.parent;
  return Boolean(
    importDeclaration &&
    isNodeOfType(importDeclaration, "ImportDeclaration") &&
    importDeclaration.source.value === "react",
  );
};

const isNamedReactApiImport = (
  identifier: EsTreeNode,
  apiNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || !isImportedFromReact(symbol)) return false;
  const importedName = getImportedName(symbol.declarationNode);
  return Boolean(importedName && includesApiName(apiNames, importedName));
};

const isReactNamespaceImport = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = resolveConstIdentifierAlias(identifier, scopes);
  if (!symbol || !isImportedFromReact(symbol)) return false;
  return (
    isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")
  );
};

export const isReactApiCall = (
  node: EsTreeNode,
  apiNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
  options: ReactApiCallOptions = {},
): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    if (isNamedReactApiImport(callee, apiNames, scopes)) return true;
    return Boolean(
      options.allowUnboundBareCalls &&
      includesApiName(apiNames, callee.name) &&
      scopes.isGlobalReference(callee),
    );
  }
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    !includesApiName(apiNames, callee.property.name)
  ) {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  if (isReactNamespaceImport(receiver, scopes)) return true;
  return Boolean(
    options.allowGlobalReactNamespace &&
    receiver.name === "React" &&
    scopes.isGlobalReference(receiver),
  );
};
