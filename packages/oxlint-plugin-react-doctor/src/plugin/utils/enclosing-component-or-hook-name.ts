import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactComponentOrHookName } from "./is-react-component-or-hook-name.js";

// Walks `node.parent` chain to find the nearest enclosing function whose
// name matches the React component (PascalCase) or hook (`use*`) naming
// convention. Returns the name when found, null otherwise.
//
// Handles three shapes:
//
//   1. `function Foo() { ... }`               → FunctionDeclaration.id
//   2. `const Foo = () => { ... }`            → VariableDeclarator.id with
//                                                ArrowFunctionExpression init
//   3. `const useFoo = function() { ... }`    → VariableDeclarator.id with
//                                                FunctionExpression init
//
// Used by rules that fire only on calls inside render scope —
// `no-create-context-in-render`, `no-create-store-in-render`, and the
// `prefer-module-scope-*` family.
export const enclosingComponentOrHookName = (node: EsTreeNode): string | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "FunctionDeclaration")) {
      const declarationName = cursor.id?.name ?? null;
      if (declarationName && isReactComponentOrHookName(declarationName)) {
        return declarationName;
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
        if (isReactComponentOrHookName(identifierName)) return identifierName;
      }
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};
