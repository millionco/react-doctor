import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasPossibleStaticPropertyWriteBefore } from "../../../utils/has-static-property-write-before.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getModuleNamespaceSource } from "./get-module-namespace-source.js";

export interface ApiReferenceProvenance {
  apiName: string;
  moduleSource: string;
}

export const getApiReferenceProvenance = (
  reference: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): ApiReferenceProvenance | null => {
  const candidate = stripParenExpression(reference);
  if (isNodeOfType(candidate, "MemberExpression")) {
    const apiName = getStaticPropertyName(candidate);
    const receiver = stripParenExpression(candidate.object);
    if (
      apiName &&
      isNodeOfType(receiver, "Identifier") &&
      hasPossibleStaticPropertyWriteBefore(receiver, apiName, candidate, scopes)
    ) {
      return null;
    }
    const moduleSource = getModuleNamespaceSource(candidate.object, scopes);
    return apiName && moduleSource ? { apiName, moduleSource } : null;
  }
  if (isNodeOfType(candidate, "JSXMemberExpression")) {
    const moduleSource = getModuleNamespaceSource(candidate.object, scopes);
    return moduleSource ? { apiName: candidate.property.name, moduleSource } : null;
  }
  if (!isNodeOfType(candidate, "Identifier") && !isNodeOfType(candidate, "JSXIdentifier")) {
    return null;
  }
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  visitedSymbolIds.add(symbol.id);
  const importDeclaration = getImportDeclarationForSymbol(symbol);
  const importedName = getImportedName(symbol.declarationNode);
  if (importDeclaration && importedName && typeof importDeclaration.source.value === "string") {
    return { apiName: importedName, moduleSource: importDeclaration.source.value };
  }
  if (
    symbol.kind === "ts-import-equals" &&
    isNodeOfType(symbol.declarationNode, "TSImportEqualsDeclaration") &&
    isNodeOfType(symbol.declarationNode.moduleReference, "TSQualifiedName")
  ) {
    const namespaceReference = symbol.declarationNode.moduleReference.left;
    const apiName = symbol.declarationNode.moduleReference.right.name;
    if (
      isNodeOfType(namespaceReference, "Identifier") &&
      hasPossibleStaticPropertyWriteBefore(
        namespaceReference,
        apiName,
        symbol.declarationNode,
        scopes,
      )
    ) {
      return null;
    }
    const moduleSource = getModuleNamespaceSource(namespaceReference, scopes);
    return moduleSource ? { apiName, moduleSource } : null;
  }
  if (symbol.kind !== "const" || !symbol.initializer) return null;
  const destructuredName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  if (destructuredName) {
    const namespaceReference = stripParenExpression(symbol.initializer);
    if (
      isNodeOfType(namespaceReference, "Identifier") &&
      hasPossibleStaticPropertyWriteBefore(
        namespaceReference,
        destructuredName,
        symbol.declarationNode,
        scopes,
      )
    ) {
      return null;
    }
    const moduleSource = getModuleNamespaceSource(symbol.initializer, scopes);
    return moduleSource ? { apiName: destructuredName, moduleSource } : null;
  }
  if (
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  return getApiReferenceProvenance(symbol.initializer, scopes, visitedSymbolIds);
};
