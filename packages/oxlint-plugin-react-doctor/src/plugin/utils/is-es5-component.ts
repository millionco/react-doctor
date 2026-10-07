import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

const PRAGMA = "React";
const CREATE_CLASS = "createReactClass";

// Port of `oxc_linter::utils::react::is_es5_component`. Returns true when
// `node` is a `CallExpression` invoking either `createReactClass(...)` or
// `React.createReactClass(...)` or the original `React.createClass(...)` factory.
export const isEs5Component = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;

  if (isNodeOfType(callee, "MemberExpression")) {
    if (
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === PRAGMA &&
      isNodeOfType(callee.property, "Identifier") &&
      (callee.property.name === CREATE_CLASS || callee.property.name === "createClass")
    ) {
      return true;
    }
    return false;
  }

  if (isNodeOfType(callee, "Identifier")) {
    return callee.name === CREATE_CLASS;
  }

  return false;
};
