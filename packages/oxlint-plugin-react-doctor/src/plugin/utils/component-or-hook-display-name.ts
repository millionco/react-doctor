import { COMPONENT_HOC_WRAPPER_NAMES } from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFinalSequenceExpressionValue } from "./get-final-sequence-expression-value.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactComponentOrHookName } from "./is-react-component-or-hook-name.js";

const hocWrapperCalleeName = (
  callee: EsTreeNode,
  allowSequenceExpressionHocCallee: boolean,
): string | null => {
  const resolvedCallee = allowSequenceExpressionHocCallee
    ? getFinalSequenceExpressionValue(callee)
    : callee;
  if (isNodeOfType(resolvedCallee, "Identifier")) return resolvedCallee.name;
  if (
    isNodeOfType(resolvedCallee, "MemberExpression") &&
    isNodeOfType(resolvedCallee.property, "Identifier")
  ) {
    return resolvedCallee.property.name;
  }
  return null;
};

export const findComponentHocExpressionRoot = (
  functionNode: EsTreeNode,
  allowSequenceExpressionHocCallee = false,
): EsTreeNode => {
  let current = findTransparentExpressionRoot(functionNode);
  for (;;) {
    const parent = current.parent;
    if (!parent || !isNodeOfType(parent, "CallExpression") || parent.arguments?.[0] !== current) {
      return current;
    }
    const calleeName = hocWrapperCalleeName(parent.callee, allowSequenceExpressionHocCallee);
    if (!calleeName || !COMPONENT_HOC_WRAPPER_NAMES.has(calleeName)) return current;
    current = findTransparentExpressionRoot(parent);
  }
};

// Resolves a function's display name from its binding after unwrapping
// component HOCs:
//
//   const App = () => {}
//   const App = memo(() => {})
//   const Input = forwardRef((props, ref) => {})
//   const App = memo(forwardRef(() => {}))
const displayNameFromFunctionBinding = (
  functionNode: EsTreeNode,
  allowSequenceExpressionHocCallee: boolean,
): string | null => {
  const current = findComponentHocExpressionRoot(functionNode, allowSequenceExpressionHocCallee);
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
export const componentOrHookDisplayNameForFunction = (
  functionNode: EsTreeNode,
  allowSequenceExpressionHocCallee = false,
): string | null => {
  if (
    (isNodeOfType(functionNode, "FunctionDeclaration") ||
      isNodeOfType(functionNode, "FunctionExpression")) &&
    functionNode.id
  ) {
    return isReactComponentOrHookName(functionNode.id.name) ? functionNode.id.name : null;
  }
  return displayNameFromFunctionBinding(functionNode, allowSequenceExpressionHocCallee);
};
