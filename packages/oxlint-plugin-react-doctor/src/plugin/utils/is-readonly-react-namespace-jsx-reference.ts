import { hasPossibleStaticPropertyWrite } from "./has-static-property-write-before.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getImportedName } from "./get-imported-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";

export const isReadonlyReactNamespaceJsxReference = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const member = identifier.parent;
  const tag = member?.parent;
  if (
    !isNodeOfType(member, "JSXMemberExpression") ||
    member.object !== identifier ||
    (member.property.name !== "StrictMode" && member.property.name !== "Fragment") ||
    (!isNodeOfType(tag, "JSXOpeningElement") && !isNodeOfType(tag, "JSXClosingElement")) ||
    tag.name !== member
  )
    return false;
  const provider = resolveConstIdentifierAlias(identifier, scopes);
  return Boolean(
    provider &&
    getValueImportSource(provider) === "react" &&
    (isNodeOfType(provider.declarationNode, "ImportDefaultSpecifier") ||
      isNodeOfType(provider.declarationNode, "ImportNamespaceSpecifier") ||
      getImportedName(provider.declarationNode) === "default") &&
    !hasPossibleStaticPropertyWrite(provider.bindingIdentifier, member.property.name, scopes) &&
    getEquivalentSymbols(provider.bindingIdentifier, scopes).every((symbol) =>
      symbol.references.every(
        (reference) =>
          reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
      ),
    ),
  );
};
