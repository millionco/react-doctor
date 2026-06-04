import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isHookCall } from "./is-hook-call.js";

// Walks up from `node` through enclosing scopes to verify that
// `setterName` was destructured from a `useState()` call — i.e.
// `const [x, setterName] = useState(...)`. Returns false when the
// name merely matches the `/^set[A-Z]/` naming convention but has
// no actual `useState` binding, which is the main source of false
// positives for setter-based rules in non-React (or React-adjacent
// but non-state) code.
export const isUseStateSetterInScope = (node: EsTreeNode, setterName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
          const elements = declarator.id.elements ?? [];
          if (elements.length < 2) continue;
          const setterElement = elements[1];
          if (
            !isNodeOfType(setterElement, "Identifier") ||
            setterElement.name !== setterName
          ) {
            continue;
          }
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          if (!isHookCall(declarator.init, "useState")) continue;
          return true;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};
