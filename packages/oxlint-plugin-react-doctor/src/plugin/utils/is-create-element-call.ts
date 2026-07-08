import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Walks a member-expression chain looking for any segment named
// `document`. Catches `document.createElement(...)`,
// `window.document.createElement(...)`,
// `dom.window.document.createElement(...)`, etc. — every level of
// indirection people use to access the DOM document.
const memberChainContainsDocument = (memberExpression: EsTreeNode): boolean => {
  let current: EsTreeNode | null = memberExpression;
  while (current) {
    if (isNodeOfType(current, "MemberExpression")) {
      if (isNodeOfType(current.property, "Identifier") && current.property.name === "document") {
        return true;
      }
      if (isNodeOfType(current.object, "Identifier") && current.object.name === "document") {
        return true;
      }
      current = current.object as EsTreeNode;
      continue;
    }
    if (isNodeOfType(current, "Identifier") && current.name === "document") return true;
    return false;
  }
  return false;
};

// Port of `oxc_linter::utils::react::is_create_element_call`. Returns true
// when `node` is a `CallExpression` whose callee is one of:
//   - `createElement(...)`
//   - `<X>.createElement(...)` (where the chain does NOT include `document`)
//   - `<X>["createElement"](...)` computed access (same `document` exclusion)
// Excludes `<any.chain>.document.createElement` (DOM API, not React's).
export const isCreateElementCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;

  if (isNodeOfType(callee, "Identifier")) return callee.name === "createElement";

  if (isNodeOfType(callee, "MemberExpression")) {
    const propertyIsCreateElement = callee.computed
      ? isNodeOfType(callee.property, "Literal") && callee.property.value === "createElement"
      : isNodeOfType(callee.property, "Identifier") && callee.property.name === "createElement";
    if (!propertyIsCreateElement) return false;
    // Walk the chain — `dom.window.document.createElement(...)` has
    // `document` somewhere in the object chain (not just the immediate
    // object), and that's still the DOM API.
    return !memberChainContainsDocument(callee.object as EsTreeNode);
  }

  return false;
};
