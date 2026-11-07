import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { hasClosedJsonSnapshotJsxReferences } from "./has-closed-json-snapshot-jsx-references.js";
import { isJsxFragmentElement } from "./is-jsx-fragment-element.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";

export const isClosedJsonSnapshotFragmentOpening = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (opening.attributes.length !== 0 || !isJsxFragmentElement(opening, scopes)) return false;
  const isNamespace = isNodeOfType(opening.name, "JSXMemberExpression");
  const identifier = isNodeOfType(opening.name, "JSXMemberExpression")
    ? opening.name.object
    : opening.name;
  if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  if (symbol?.kind !== "import") return false;
  const declaration = getImportDeclarationForSymbol(symbol);
  return Boolean(
    declaration?.source.value === "react" &&
    !isTypeOnlyImport(declaration) &&
    !(
      isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type"
    ) &&
    hasClosedJsonSnapshotJsxReferences(symbol, isNamespace),
  );
};
