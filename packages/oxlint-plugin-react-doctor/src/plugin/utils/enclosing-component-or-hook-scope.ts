import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactComponentOrHookName } from "./is-react-component-or-hook-name.js";
import type { ScopeAnalysis, ScopeDescriptor } from "../semantic/scope-analysis.js";

export interface EnclosingComponentInfo {
  readonly functionNode: EsTreeNode;
  readonly bodyScope: ScopeDescriptor;
  readonly displayName: string;
}

// Scope-aware variant of `enclosingComponentOrHookName`. Walks
// `node.parent` to find the nearest enclosing function whose name
// matches the React component (PascalCase) or hook (`use*`)
// convention, and returns its body scope so callers can run scope
// queries (closureCaptures, isDescendantScope, etc.) against the
// component boundary.
//
// Used by `prefer-module-scope-pure-function` and
// `prefer-module-scope-static-value`.
export const enclosingComponentOrHookScope = (
  startNode: EsTreeNode,
  ownScopeFor: ScopeAnalysis["ownScopeFor"],
): EnclosingComponentInfo | null => {
  let cursor: EsTreeNode | null | undefined = startNode.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "FunctionDeclaration")) {
      const declarationName = cursor.id?.name ?? null;
      if (declarationName && isReactComponentOrHookName(declarationName)) {
        const bodyScope = ownScopeFor(cursor);
        if (bodyScope) {
          return { functionNode: cursor, bodyScope, displayName: declarationName };
        }
      }
    }
    // Named FunctionExpression passed as an argument to a HOC wrapper:
    //   const App = memo(function App() { ... })
    //   const Input = forwardRef(function Input(props, ref) { ... })
    if (isNodeOfType(cursor, "FunctionExpression")) {
      const expressionName = cursor.id?.name ?? null;
      if (expressionName && isReactComponentOrHookName(expressionName)) {
        const bodyScope = ownScopeFor(cursor);
        if (bodyScope) {
          return { functionNode: cursor, bodyScope, displayName: expressionName };
        }
      }
    }
    if (isNodeOfType(cursor, "VariableDeclarator")) {
      const initializer = cursor.init;
      const isFunctionInitializer =
        initializer &&
        (isNodeOfType(initializer, "ArrowFunctionExpression") ||
          isNodeOfType(initializer, "FunctionExpression"));
      if (isFunctionInitializer && isNodeOfType(cursor.id, "Identifier")) {
        const identifierName = cursor.id.name;
        if (isReactComponentOrHookName(identifierName)) {
          const bodyScope = ownScopeFor(initializer);
          if (bodyScope) {
            return { functionNode: initializer, bodyScope, displayName: identifierName };
          }
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};
