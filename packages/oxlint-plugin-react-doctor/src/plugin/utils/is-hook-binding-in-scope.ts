import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isHookCall } from "./is-hook-call.js";

interface HookBindingQuery {
  /** The identifier name to look for (e.g. `"setCount"`, `"dispatch"`, `"ref"`). */
  bindingName: string;
  /** Hook name(s) the binding must originate from (e.g. `"useState"`, `new Set(["useState", "useReducer"])`). */
  hookName: string | Set<string>;
  /**
   * For array-destructured hooks, the zero-based element index the
   * binding must occupy.
   *  - `0` → state value  (`const [count, _] = useState(0)`)
   *  - `1` → setter / dispatch  (`const [_, setCount] = useState(0)`)
   *
   * Omit (or pass `undefined`) for simple bindings
   * (`const ref = useRef(null)`), which match when the declarator id
   * is the Identifier itself (no destructuring).
   */
  destructureIndex?: number;
}

// Walks up from `node` through enclosing BlockStatement / Program
// scopes to verify that `bindingName` was bound from a call to
// `hookName`. Supports both array-destructured hooks (useState,
// useReducer, useTransition) and simple bindings (useRef, useContext).
//
// This is the generic version of the false-positive guard: instead of
// trusting a naming convention (`/^set[A-Z]/`) we prove the identifier
// actually came from the hook the rule cares about.
export const isHookBindingInScope = (node: EsTreeNode, query: HookBindingQuery): boolean => {
  const { bindingName, hookName, destructureIndex } = query;
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          if (!isHookCall(declarator.init, hookName)) continue;

          if (destructureIndex !== undefined) {
            // Array-destructured: const [a, b] = useHook(...)
            if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
            const elements = declarator.id.elements ?? [];
            if (elements.length <= destructureIndex) continue;
            const element = elements[destructureIndex];
            if (isNodeOfType(element, "Identifier") && element.name === bindingName) return true;
          } else {
            // Simple binding: const x = useHook(...)
            if (isNodeOfType(declarator.id, "Identifier") && declarator.id.name === bindingName) {
              return true;
            }
          }
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};
