import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import type { RuleContext } from "./rule-context.js";

// Any module under a `ui/` directory is a shadcn-generated part
// (`@/components/ui/button`, `~/ui/card`). Rules use this to tell generated
// leaf building blocks apart from arbitrary custom components whose rendered
// content they cannot reason about.
export const SHADCN_UI_MODULE_SOURCE_PATTERN = /(?:^|\/)ui\/(?:components\/)?[^/]+$/;

/**
 * Resolves a JSX element name to the originally-exported component name of a
 * value import whose module specifier matches `moduleSourcePattern` — the
 * shape shadcn ui modules (and per-primitive headless packages) are imported
 * through (`@/components/ui/dialog`, `~/ui/dialog`, `./dialog`,
 * `@radix-ui/react-dialog`). Handles renamed named imports
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
    const source = getValueImportSource(symbol);
    if (source === null || !moduleSourcePattern.test(source)) return null;
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
  const source = getValueImportSource(symbol);
  if (source === null || !moduleSourcePattern.test(source)) return null;
  return elementName.property.name;
};
