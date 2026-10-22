import { REACT_PROVIDER_MUTATION_CAPABILITY_NAMES } from "../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNonEscapingReactApiReference } from "./is-non-escaping-react-api-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";

const isDefaultImport = (symbol: SymbolDescriptor): boolean =>
  isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
  getImportedName(symbol.declarationNode) === "default";

const isReactImport = (symbol: SymbolDescriptor): boolean => {
  const declaration = getImportDeclarationForSymbol(symbol);
  return Boolean(
    declaration &&
    declaration.source.value === "react" &&
    declaration.importKind !== "type" &&
    (!isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
      symbol.declarationNode.importKind !== "type"),
  );
};

export const hasReactDefaultProviderMutation = (
  propertyName: string,
  scopes: ScopeAnalysis,
): boolean => {
  return scopes.rootScope.symbols.some((symbol) => {
    if (!isReactImport(symbol)) return false;
    const isNamespaceImport = isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier");
    if (!isDefaultImport(symbol) && !isNamespaceImport) return false;
    if (hasPossibleStaticPropertyMutationOrEscape(symbol.bindingIdentifier, propertyName, scopes)) {
      return true;
    }
    return getEquivalentSymbols(symbol.bindingIdentifier, scopes).some((alias) =>
      alias.references.some((reference) => {
        if (reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier)) {
          return true;
        }
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const member = referenceRoot.parent;
        if (!isNodeOfType(member, "MemberExpression") || member.object !== referenceRoot) {
          return !(
            isNodeOfType(member, "VariableDeclarator") &&
            member.init === referenceRoot &&
            isNodeOfType(member.id, "Identifier") &&
            isNodeOfType(member.parent, "VariableDeclaration") &&
            member.parent.kind === "const"
          );
        }
        const referencedProperty = getStaticPropertyName(member);
        return (
          referencedProperty === null ||
          REACT_PROVIDER_MUTATION_CAPABILITY_NAMES.has(referencedProperty) ||
          (isNamespaceImport && referencedProperty === "default") ||
          (referencedProperty === propertyName && !isNonEscapingReactApiReference(member))
        );
      }),
    );
  });
};
