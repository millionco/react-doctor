import { COMPONENT_HOC_WRAPPER_NAMES } from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactComponentOrHookName } from "./is-react-component-or-hook-name.js";

const hocWrapperCalleeName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return callee.property.name;
  }
  return null;
};

// Resolves the display name for an anonymous function (arrow or
// unnamed function expression) from the binding it is assigned to,
// unwrapping any chain of component HOC wrappers along the way:
//
//   const App = () => {}
//   const App = memo(() => {})
//   const Input = forwardRef((props, ref) => {})
//   const App = memo(forwardRef(() => {}))
const displayNameFromFunctionBinding = (functionNode: EsTreeNode): string | null => {
  let current: EsTreeNode = functionNode;
  for (;;) {
    const parent = current.parent;
    if (parent && isNodeOfType(parent, "CallExpression") && parent.arguments?.[0] === current) {
      const calleeName = hocWrapperCalleeName(parent.callee);
      if (calleeName && COMPONENT_HOC_WRAPPER_NAMES.has(calleeName)) {
        current = parent;
        continue;
      }
    }
    break;
  }
  const binding = current.parent;
  if (
    binding &&
    isNodeOfType(binding, "VariableDeclarator") &&
    isNodeOfType(binding.id, "Identifier") &&
    binding.init === current
  ) {
    return isReactComponentOrHookName(binding.id.name) ? binding.id.name : null;
  }
  return null;
};

// Returns the React component (PascalCase) or hook (`use*`) display
// name for `functionNode`, or null when the function isn't a
// component/hook. Handles named declarations / expressions
// (`function App()`, `memo(function App(){})`) and anonymous functions
// bound to a name directly or through a HOC wrapper.
export const componentOrHookDisplayNameForFunction = (functionNode: EsTreeNode): string | null => {
  if (
    (isNodeOfType(functionNode, "FunctionDeclaration") ||
      isNodeOfType(functionNode, "FunctionExpression")) &&
    functionNode.id
  ) {
    return isReactComponentOrHookName(functionNode.id.name) ? functionNode.id.name : null;
  }
  return displayNameFromFunctionBinding(functionNode);
};

// Walks up from `node` to the nearest enclosing function-like node
// (skipping `node` itself), or null when `node` lives at module scope.
export const nearestEnclosingFunction = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};
