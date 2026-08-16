import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import type { RuleContext } from "./rule-context.js";

const getValueImportDeclaration = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (symbol.kind !== "import") return null;
  const declaration = symbol.declarationNode.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    isTypeOnlyImport(declaration) ||
    (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type")
  ) {
    return null;
  }
  return declaration;
};

const importSourceMatches = (declaration: EsTreeNode, moduleSourcePattern: RegExp): boolean => {
  if (!isNodeOfType(declaration, "ImportDeclaration")) return false;
  const source = declaration.source.value;
  return typeof source === "string" && moduleSourcePattern.test(source);
};

/**
 * Resolves a JSX element name to the originally-exported component name of a
 * value import whose module specifier matches `moduleSourcePattern` — the
 * shape shadcn ui modules are imported through (`@/components/ui/dialog`,
 * `~/ui/dialog`, `./dialog`). Handles renamed named imports
 * (`import { DialogTitle as Title }` resolves to `"DialogTitle"`) and
 * namespace member access (`import * as Dialog from "./dialog"` with
 * `<Dialog.DialogTitle>` resolves to `"DialogTitle"`). Returns null for
 * local components, other modules, type-only imports, and member chains
 * deeper than one level.
 */
export const resolveShadcnUiComponentName = (
  elementName: EsTreeNode,
  moduleSourcePattern: RegExp,
  context: RuleContext,
): string | null => {
  if (isNodeOfType(elementName, "JSXIdentifier")) {
    const symbol = resolveConstIdentifierAlias(elementName, context.scopes);
    if (!symbol) return null;
    const declaration = getValueImportDeclaration(symbol);
    if (!declaration || !importSourceMatches(declaration, moduleSourcePattern)) return null;
    return getImportedName(symbol.declarationNode) ?? null;
  }
  if (
    !isNodeOfType(elementName, "JSXMemberExpression") ||
    !isNodeOfType(elementName.object, "JSXIdentifier")
  ) {
    return null;
  }
  const symbol = resolveConstIdentifierAlias(elementName.object, context.scopes);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) return null;
  const declaration = getValueImportDeclaration(symbol);
  if (!declaration || !importSourceMatches(declaration, moduleSourcePattern)) return null;
  return elementName.property.name;
};
