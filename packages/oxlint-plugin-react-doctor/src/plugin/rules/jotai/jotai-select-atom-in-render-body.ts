import { MEMOIZING_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import {
  isImportedFromModule,
  getImportedNameFromModule,
} from "../../utils/find-import-source-for-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: `selectAtom(base, selector)` returns a NEW atom on every call.
// Calling it in a component / hook body without `useMemo` rebuilds
// the derived atom on every render — `useAtomValue` then subscribes
// to a brand new atom each render and triggers an infinite render
// loop (jotai's documented #1 footgun). The fix is either:
//   (a) lift the `selectAtom(...)` call to module scope, or
//   (b) wrap it in `useMemo(() => selectAtom(base, selector), [deps])`.

const JOTAI_SELECT_ATOM_SOURCES = ["jotai/utils", "jotai"];

const COMPONENT_NAME_PATTERN = /^[A-Z]/;
const HOOK_NAME_PATTERN = /^use[A-Z]/;

const isFunctionLikeNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionDeclaration") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "ArrowFunctionExpression");

const isImportedSelectAtom = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (!isNodeOfType(callExpression.callee, "Identifier")) return false;
  const localName = callExpression.callee.name;
  for (const source of JOTAI_SELECT_ATOM_SOURCES) {
    if (!isImportedFromModule(callExpression, localName, source)) continue;
    const importedName = getImportedNameFromModule(callExpression, localName, source);
    if (importedName === "selectAtom") return true;
  }
  return false;
};

const isCallbackOfMemoizingHook = (functionNode: EsTreeNode): boolean => {
  const callParent = functionNode.parent;
  if (!isNodeOfType(callParent, "CallExpression")) return false;
  if (!isNodeOfType(callParent.callee, "Identifier")) return false;
  if (!MEMOIZING_HOOK_NAMES.has(callParent.callee.name)) return false;
  // The function must be the FIRST argument to count as the
  // memoizing callback — `useMemo(..., [arg, selectAtomFn])` is not
  // the same thing.
  return callParent.arguments?.[0] === functionNode;
};

const containingFunctionIsComponentOrHook = (functionNode: EsTreeNode): boolean => {
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    const declaredName = functionNode.id.name;
    return COMPONENT_NAME_PATTERN.test(declaredName) || HOOK_NAME_PATTERN.test(declaredName);
  }
  // ArrowFunctionExpression / FunctionExpression — look for the
  // surrounding VariableDeclarator. `memo(...)` and `forwardRef(...)`
  // wrappers are transparent here: walk past intermediate calls until
  // we find the binding.
  let cursor: EsTreeNode | null | undefined = functionNode.parent ?? null;
  while (cursor && isNodeOfType(cursor, "CallExpression")) {
    cursor = cursor.parent ?? null;
  }
  if (!cursor) return false;
  if (!isNodeOfType(cursor, "VariableDeclarator")) return false;
  if (!isNodeOfType(cursor.id, "Identifier")) return false;
  return COMPONENT_NAME_PATTERN.test(cursor.id.name) || HOOK_NAME_PATTERN.test(cursor.id.name);
};

export const jotaiSelectAtomInRenderBody = defineRule<Rule>({
  id: "jotai-select-atom-in-render-body",
  severity: "error",
  recommendation:
    "Lift `selectAtom(base, fn)` to module scope, or wrap it: `const atom = useMemo(() => selectAtom(base, fn), [deps])`. Calling it in render rebuilds the derived atom every render and infinitely re-subscribes",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isImportedSelectAtom(node)) return;

      // Walk up to find the nearest enclosing function. If that
      // function itself is the callback of useMemo / useCallback,
      // the selectAtom call is memoized — fine.
      let cursor: EsTreeNode | null | undefined = node.parent ?? null;
      let nearestFunctionLike: EsTreeNode | null = null;
      while (cursor) {
        if (isFunctionLikeNode(cursor)) {
          nearestFunctionLike = cursor;
          break;
        }
        cursor = cursor.parent ?? null;
      }
      if (!nearestFunctionLike) return;
      if (isCallbackOfMemoizingHook(nearestFunctionLike)) return;

      // Now walk up again from the nearest function looking for any
      // enclosing component or hook. Helpers nested inside a
      // component are still "render-time" execution paths.
      let outerCursor: EsTreeNode | null = nearestFunctionLike;
      while (outerCursor) {
        if (isFunctionLikeNode(outerCursor) && containingFunctionIsComponentOrHook(outerCursor)) {
          context.report({
            node,
            message:
              "`selectAtom(...)` called in a component / hook body without `useMemo` — every render builds a new derived atom and `useAtomValue` re-subscribes forever. Lift it to module scope or wrap with `useMemo(() => selectAtom(...), [deps])`",
          });
          return;
        }
        outerCursor = outerCursor.parent ?? null;
      }
    },
  }),
});
