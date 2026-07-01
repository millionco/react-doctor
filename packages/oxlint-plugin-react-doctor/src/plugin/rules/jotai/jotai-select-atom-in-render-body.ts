import {
  EFFECT_HOOK_NAMES,
  HANDLER_FUNCTION_NAME_PATTERN,
  HOOK_NAME_PATTERN,
  MEMOIZING_HOOK_NAMES,
  REACT_HANDLER_PROP_PATTERN,
} from "../../constants/react.js";
import { collectHandlerReferencedNames } from "../../utils/collect-handler-referenced-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import {
  isImportedFromModule,
  getImportedNameFromModule,
} from "../../utils/find-import-source-for-name.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getFunctionBindingName } from "../../utils/get-function-binding-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
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
    // First argument only — `useMemo(..., [selectAtomFn])` is not the callback.
    parent.arguments?.[0] === functionNode
  ) {
    // Bare callee (`useMemo(...)`) or namespaced (`React.useMemo(...)`) — read
    // the hook name from the Identifier or the MemberExpression property.
    const hookName = getCalleeName(parent);
    if (hookName && (MEMOIZING_HOOK_NAMES.has(hookName) || EFFECT_HOOK_NAMES.has(hookName))) {
      return true;
    }
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
      REACT_HANDLER_PROP_PATTERN.test(attribute.name.name)
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
  create: (context: RuleContext) => {
    let handlerReferencedNames: Set<string> | null = null;
    const isBindingUsedAsHandler = (functionNode: EsTreeNode): boolean => {
      const bindingName = getFunctionBindingName(functionNode);
      if (!bindingName) return false;
      if (!handlerReferencedNames) {
        let root: EsTreeNode = functionNode;
        while (root.parent) root = root.parent;
        handlerReferencedNames = collectHandlerReferencedNames(root);
      }
      return handlerReferencedNames.has(bindingName);
    };

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isImportedSelectAtom(node)) return;

        // Walk up to find the nearest enclosing function. If that
        // function itself is the callback of useMemo / useCallback,
        // the selectAtom call is memoized — fine.
        const nearestFunctionLike = findEnclosingFunction(node);
        if (!nearestFunctionLike) return;
        if (isDeferredCallback(nearestFunctionLike)) return;
        if (isBindingUsedAsHandler(nearestFunctionLike)) return;

        // Now walk up again from the nearest function looking for any
        // enclosing component or hook. Helpers nested inside a
        // component are still "render-time" execution paths.
        let outerCursor: EsTreeNode | null = nearestFunctionLike;
        while (outerCursor) {
          if (isFunctionLike(outerCursor) && containingFunctionIsComponentOrHook(outerCursor)) {
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
    };
  },
});
