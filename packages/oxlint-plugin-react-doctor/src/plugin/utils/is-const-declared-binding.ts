import type { BindingInfo } from "./find-variable-initializer.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// AST node types allowed between a binding Identifier and its enclosing
// VariableDeclaration. Anything else (a function, an import specifier, a
// class) means the binding is not a variable declaration at all.
const BINDING_PATTERN_ANCESTOR_TYPES = new Set<string>([
  "VariableDeclarator",
  "ObjectPattern",
  "ArrayPattern",
  "AssignmentPattern",
  "Property",
  "RestElement",
]);

// True when the binding comes from a `const` VariableDeclaration — the one
// declaration kind whose initializer is also the binding's value for the
// whole scope. Parameters, imports, function/class declarations, and
// `let` / `var` bindings (reassignable after declaration) return false.
export const isConstDeclaredBinding = (binding: BindingInfo | null | undefined): boolean => {
  if (!binding) return false;
  let ancestor: EsTreeNode | null | undefined = binding.bindingIdentifier.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "VariableDeclaration")) return ancestor.kind === "const";
    if (!BINDING_PATTERN_ANCESTOR_TYPES.has(ancestor.type)) return false;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};
