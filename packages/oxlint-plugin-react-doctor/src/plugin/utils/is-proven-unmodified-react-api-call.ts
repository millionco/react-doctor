import { isReadonlyReactNamespaceJsxReference } from "./is-readonly-react-namespace-jsx-reference.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNonEscapingReactApiReference } from "./is-non-escaping-react-api-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isProvenUnmodifiedReactApiCall = (
  call: EsTreeNode,
  apiNames: string | ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const invocation = stripParenExpression(call);
  if (
    !isNodeOfType(invocation, "CallExpression") ||
    !isReactApiCall(invocation, apiNames, scopes)
  ) {
    return false;
  }
  const callee = stripParenExpression(invocation.callee);
  const identifier = getRootIdentifier(callee);
  const symbol = identifier ? scopes.symbolFor(identifier) : null;
  if (
    !identifier ||
    symbol?.kind !== "import" ||
    symbol.references.some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    )
  ) {
    return false;
  }
  if (isNodeOfType(callee, "MemberExpression")) {
    const propertyName = getStaticPropertyName(callee);
    if (
      !propertyName ||
      hasPossibleStaticPropertyMutationOrEscape(identifier, propertyName, scopes, (reference) =>
        isReadonlyReactNamespaceJsxReference(reference, scopes),
      )
    ) {
      return false;
    }
    return getEquivalentSymbols(identifier, scopes).every((namespaceSymbol) =>
      namespaceSymbol.references.every((reference) => {
        if (isReadonlyReactNamespaceJsxReference(reference.identifier, scopes)) return true;
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const member = referenceRoot.parent;
        if (!isNodeOfType(member, "MemberExpression") || member.object !== referenceRoot) {
          return (
            isNodeOfType(member, "VariableDeclarator") &&
            member.init === referenceRoot &&
            isNodeOfType(member.id, "Identifier") &&
            isNodeOfType(member.parent, "VariableDeclaration") &&
            member.parent.kind === "const"
          );
        }
        const referencedProperty = getStaticPropertyName(member);
        return (
          (referencedProperty !== null && referencedProperty !== propertyName) ||
          isNonEscapingReactApiReference(member)
        );
      }),
    );
  }
  return symbol.references.every((reference) =>
    isNonEscapingReactApiReference(reference.identifier),
  );
};
