import type { EsTreeNode } from "./es-tree-node.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True for the legacy `<XContext.Provider …>` member shape, or the
// React 19 shorthand `<XContext …>` when the JSX identifier resolves to
// a top-level createContext binding (not a local shadow like a prop or
// destructured variable with the same name).
export const isContextProviderJsxName = (
  node: EsTreeNode,
  contextBindings: ReadonlySet<string>,
): boolean => {
  if (isNodeOfType(node, "JSXMemberExpression")) return node.property.name === "Provider";
  if (!isNodeOfType(node, "JSXIdentifier") || !contextBindings.has(node.name)) return false;
  const binding = findVariableInitializer(node, node.name);
  return binding?.scopeOwner.type === "Program";
};
