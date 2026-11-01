import { getDefaultOrNamespaceImportKind } from "./get-default-or-namespace-import-kind.js";
import { isValueImportFromModule } from "./is-value-import-from-module.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNonEscapingReactApiReference } from "./is-non-escaping-react-api-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const hasCrossFileReactDefaultProviderMutation = (
  nativeCall: EsTreeNode,
  helperScopes: ScopeAnalysis,
  callerScopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(nativeCall, "CallExpression")) return false;
  const callee = stripParenExpression(nativeCall.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  const provider = isNodeOfType(receiver, "Identifier") ? helperScopes.symbolFor(receiver) : null;
  if (
    !provider ||
    !isValueImportFromModule(provider, "react") ||
    getDefaultOrNamespaceImportKind(provider) !== "default"
  )
    return false;
  const propertyName = getStaticPropertyName(callee);
  if (!propertyName) return true;
  return callerScopes.rootScope.symbols.some((symbol) => {
    if (!isValueImportFromModule(symbol, "react")) return false;
    const isNamespaceImport = isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier");
    if (getDefaultOrNamespaceImportKind(symbol) !== "default" && !isNamespaceImport) return false;
    if (
      hasPossibleStaticPropertyMutationOrEscape(
        symbol.bindingIdentifier,
        propertyName,
        callerScopes,
      )
    ) {
      return true;
    }
    return getEquivalentSymbols(symbol.bindingIdentifier, callerScopes).some((alias) =>
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
          (isNamespaceImport && referencedProperty === "default") ||
          (referencedProperty === propertyName && !isNonEscapingReactApiReference(member))
        );
      }),
    );
  });
};
