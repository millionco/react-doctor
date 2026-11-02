import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

/**
 * Flattens a JSX opener / member-expression chain into a dotted name.
 *
 *   `<Foo />`           → `"Foo"`
 *   `<Namespace.Foo />` → `"Namespace.Foo"`
 *   `<a.b.c />`         → `"a.b.c"`
 *
 * Returns `null` when the chain root isn't a `JSXIdentifier` (e.g.
 * the rare-but-valid `<this.x />` case, which JSX surfaces as a
 * `JSXThisExpression` root).
 *
 * Namespaced JSX names stay out of this helper because callers differ on
 * whether `svg:path` should become a tag string or be treated as unsupported.
 */
export const flattenJsxName = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "JSXIdentifier")) return node.name;
  if (isNodeOfType(node, "JSXMemberExpression")) {
    const objectName = flattenJsxName(node.object);
    if (!objectName) return null;
    return `${objectName}.${node.property.name}`;
  }
  return null;
};
