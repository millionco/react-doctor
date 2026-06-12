import { REACT_HOC_NAMES } from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

const reactHocCalleeName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "React" &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return `React.${callee.property.name}`;
  }
  return null;
};

// Mirrors upstream eslint-plugin-react-hooks: the render callback
// passed as the FIRST argument to `memo(...)` / `forwardRef(...)` IS
// a component by construction, regardless of what binding name it
// ends up under (`const _Wrapped = forwardRef((props, ref) => …)`).
// Later arguments are not render callbacks (`memo`'s second argument
// is the props comparator), so they are never promoted.
export const isReactHocCallbackArgument = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if (parent.arguments[0] !== functionNode) return false;
  const calleeName = reactHocCalleeName(parent.callee);
  return calleeName !== null && REACT_HOC_NAMES.has(calleeName);
};
