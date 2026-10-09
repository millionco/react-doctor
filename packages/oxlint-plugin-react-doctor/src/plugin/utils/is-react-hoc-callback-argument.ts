import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { hasSymbolWriteBefore } from "./has-symbol-write-before.js";
import { isReactApiCall } from "./is-react-api-call.js";
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
export const isReactHocCallbackArgument = (
  functionNode: EsTreeNode,
  scopes?: ScopeAnalysis,
): boolean => {
  const parent = functionNode.parent;
  if (isNodeOfType(parent, "CallExpression") && parent.arguments[0] === functionNode) {
    const calleeName = reactHocCalleeName(parent.callee);
    if (calleeName !== null && REACT_HOC_NAMES.has(calleeName)) return true;
  }
  if (!scopes) return false;
  return getFunctionBindingSymbols(functionNode, scopes).some((symbol) =>
    symbol.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const call = referenceRoot.parent;
      return Boolean(
        isNodeOfType(call, "CallExpression") &&
        call.arguments[0] === referenceRoot &&
        !hasSymbolWriteBefore(symbol, reference.identifier, scopes) &&
        isReactApiCall(call, REACT_HOC_NAMES, scopes, { resolveNamedAliases: true }),
      );
    }),
  );
};
