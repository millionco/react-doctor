import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import type { RuleContext } from "./rule-context.js";

/**
 * Resolves a JSX element name to a part of a headless component namespace —
 * the import shape of the unified `radix-ui` package and Base UI, where a
 * named export (`Dialog`) is an object holding the parts:
 *
 *   `import { Dialog } from "radix-ui"` with `<Dialog.Content>` → `"Content"`
 *   `import { Dialog as D } from "@base-ui/react/dialog"` with `<D.Popup>` → `"Popup"`
 *   `import * as Radix from "radix-ui"` with `<Radix.Dialog.Content>` → `"Content"`
 *
 * Returns null for other modules, other namespace objects, type-only
 * imports, and local components.
 */
export const resolveNamespacedPartName = (
  elementName: EsTreeNode,
  moduleSourcePattern: RegExp,
  namespaceExportName: string,
  context: RuleContext,
): string | null => {
  if (!isNodeOfType(elementName, "JSXMemberExpression")) return null;
  if (isNodeOfType(elementName.object, "JSXIdentifier")) {
    const symbol = resolveConstIdentifierAlias(elementName.object, context.scopes);
    if (!symbol) return null;
    const source = getValueImportSource(symbol);
    if (source === null || !moduleSourcePattern.test(source)) return null;
    return getImportedName(symbol.declarationNode) === namespaceExportName
      ? elementName.property.name
      : null;
  }
  if (
    !isNodeOfType(elementName.object, "JSXMemberExpression") ||
    !isNodeOfType(elementName.object.object, "JSXIdentifier") ||
    elementName.object.property.name !== namespaceExportName
  ) {
    return null;
  }
  const namespaceSymbol = resolveConstIdentifierAlias(elementName.object.object, context.scopes);
  if (
    !namespaceSymbol ||
    !isNodeOfType(namespaceSymbol.declarationNode, "ImportNamespaceSpecifier")
  ) {
    return null;
  }
  const source = getValueImportSource(namespaceSymbol);
  return source !== null && moduleSourcePattern.test(source) ? elementName.property.name : null;
};
