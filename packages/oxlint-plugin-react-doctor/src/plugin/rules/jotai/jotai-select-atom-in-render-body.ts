import {
  EFFECT_HOOK_NAMES,
  HANDLER_FUNCTION_NAME_PATTERN,
  MEMOIZING_HOOK_NAMES,
  REACT_HANDLER_PROP_PATTERN,
  UPPERCASE_PATTERN,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import {
  isImportedFromModule,
  getImportedNameFromModule,
} from "../../utils/find-import-source-for-name.js";
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

// A function scope where `selectAtom(...)` does NOT run on every render:
// a useMemo/useCallback callback (cached), a useEffect/useLayoutEffect
// callback (post-commit), or an event handler (fires on interaction) — the
// latter recognized as a `handle*`/`on*`-named binding, an inline JSX `onX`
// attribute value, or an `onX` object property. Such a `selectAtom` call
// makes its atom once / on demand, not the per-render re-subscribe loop the
// rule targets.
const isDeferredCallback = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent;

  if (
    isNodeOfType(parent, "CallExpression") &&
    isNodeOfType(parent.callee, "Identifier") &&
    (MEMOIZING_HOOK_NAMES.has(parent.callee.name) || EFFECT_HOOK_NAMES.has(parent.callee.name)) &&
    // First argument only — `useMemo(..., [selectAtomFn])` is not the callback.
    parent.arguments?.[0] === functionNode
  ) {
    return true;
  }

  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    isNodeOfType(parent.id, "Identifier") &&
    HANDLER_FUNCTION_NAME_PATTERN.test(parent.id.name)
  ) {
    return true;
  }

  if (
    isNodeOfType(functionNode, "FunctionDeclaration") &&
    functionNode.id &&
    HANDLER_FUNCTION_NAME_PATTERN.test(functionNode.id.name)
  ) {
    return true;
  }

  if (isNodeOfType(parent, "JSXExpressionContainer")) {
    const attribute = parent.parent;
    if (
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name.startsWith("on") &&
      UPPERCASE_PATTERN.test(attribute.name.name.charAt(2))
    ) {
      return true;
    }
  }

  if (isNodeOfType(parent, "Property")) {
    if (
      isNodeOfType(parent.key, "Identifier") &&
      REACT_HANDLER_PROP_PATTERN.test(parent.key.name)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent.key, "Literal") &&
      typeof parent.key.value === "string" &&
      REACT_HANDLER_PROP_PATTERN.test(parent.key.value)
    ) {
      return true;
    }
  }

  return false;
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

export const jotaiSelectAtomInRenderBody = defineRule({
  id: "jotai-select-atom-in-render-body",
  title: "selectAtom called during render",
  severity: "error",
  recommendation:
    "Lift `selectAtom(base, fn)` to module scope, or wrap it: `const atom = useMemo(() => selectAtom(base, fn), [deps])`. Calling it during render makes a new atom every time and re-subscribes forever.",
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
      if (isDeferredCallback(nearestFunctionLike)) return;

      // Now walk up again from the nearest function looking for any
      // enclosing component or hook. Helpers nested inside a
      // component are still "render-time" execution paths.
      let outerCursor: EsTreeNode | null = nearestFunctionLike;
      while (outerCursor) {
        if (isFunctionLikeNode(outerCursor) && containingFunctionIsComponentOrHook(outerCursor)) {
          context.report({
            node,
            message:
              "`selectAtom(...)` runs in a component or hook without `useMemo`, so every render makes a new atom & re-subscribes forever, freezing the page for your users. Lift it to module scope, or wrap it in `useMemo(() => selectAtom(...), [deps])`.",
          });
          return;
        }
        outerCursor = outerCursor.parent ?? null;
      }
    },
  }),
});
