import {
  EFFECT_HOOK_NAMES,
  HANDLER_FUNCTION_NAME_PATTERN,
  REACT_HANDLER_PROP_PATTERN,
  UPPERCASE_PATTERN,
} from "../../constants/react.js";
import { TANSTACK_ROUTE_FILE_PATTERN } from "../../constants/tanstack.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const tanstackStartNoNavigateInRender = defineRule({
  id: "tanstack-start-no-navigate-in-render",
  title: "navigate() called during render",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  recommendation:
    "Use `throw redirect({ to: '/path' })` in `beforeLoad` or `loader`. navigate() during render causes hydration issues.",
  create: (context: RuleContext) => {
    // HACK: only callbacks that React calls LATER are safe scopes for
    // navigate() — useEffect / useLayoutEffect (post-commit), useCallback
    // / useMemo (cached, fired by event handlers later), JSX `onXxx`
    // attributes (event handlers), `onXxx` object properties holding
    // functions (e.g. `useForm({ onSubmit: ... })`), and handler-named
    // local functions (`handleSubmit`, `onLogin`). Synchronous-iteration
    // callbacks like
    // `arr.forEach(item => navigate(item))` execute during render, so
    // they must NOT be treated as deferred — they're still render-time
    // side effects. A pure function-depth counter would skip them and
    // miss real bugs; the explicit allow-list is the correct boundary.
    let deferredCallbackDepth = 0;
    let eventHandlerDepth = 0;

    const isDeferredHookCall = (node: EsTreeNode): boolean =>
      isHookCall(node, EFFECT_HOOK_NAMES) ||
      isHookCall(node, "useCallback") ||
      isHookCall(node, "useMemo");

    const isEventHandlerAttribute = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "JSXAttribute") &&
      isNodeOfType(node.name, "JSXIdentifier") &&
      typeof node.name.name === "string" &&
      node.name.name.startsWith("on") &&
      UPPERCASE_PATTERN.test(node.name.name.charAt(2));

    const isEventHandlerProperty = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "Property") &&
      isFunctionLike(node.value) &&
      ((isNodeOfType(node.key, "Identifier") &&
        typeof node.key.name === "string" &&
        REACT_HANDLER_PROP_PATTERN.test(node.key.name)) ||
        (isNodeOfType(node.key, "Literal") &&
          typeof node.key.value === "string" &&
          REACT_HANDLER_PROP_PATTERN.test(node.key.value)));

    const isHandlerNamedVariableDeclarator = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "Identifier") &&
      typeof node.id.name === "string" &&
      HANDLER_FUNCTION_NAME_PATTERN.test(node.id.name) &&
      isFunctionLike(node.init);

    const isHandlerNamedFunctionDeclaration = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "FunctionDeclaration") &&
      isNodeOfType(node.id, "Identifier") &&
      typeof node.id.name === "string" &&
      HANDLER_FUNCTION_NAME_PATTERN.test(node.id.name);

    // Names referenced by any JSX `onXxx` attribute value or `onXxx` object
    // property — i.e. functions wired up as event handlers. Computed lazily
    // once per file and cached; `navigate()` calls are rare so the walk is cheap.
    let handlerReferencedNames: Set<string> | null = null;
    const getHandlerReferencedNames = (startNode: EsTreeNode): Set<string> => {
      if (handlerReferencedNames) return handlerReferencedNames;
      let root: EsTreeNode = startNode;
      while (root.parent) root = root.parent;
      const names = new Set<string>();
      walkAst(root, (inner: EsTreeNode) => {
        if (isEventHandlerAttribute(inner) && isNodeOfType(inner, "JSXAttribute") && inner.value) {
          collectReferenceIdentifierNames(inner.value, names);
          return;
        }
        if (
          isNodeOfType(inner, "Property") &&
          ((isNodeOfType(inner.key, "Identifier") &&
            REACT_HANDLER_PROP_PATTERN.test(inner.key.name)) ||
            (isNodeOfType(inner.key, "Literal") &&
              typeof inner.key.value === "string" &&
              REACT_HANDLER_PROP_PATTERN.test(inner.key.value)))
        ) {
          collectReferenceIdentifierNames(inner.value, names);
        }
      });
      handlerReferencedNames = names;
      return names;
    };

    // True when `navigate()` lives in a local function whose binding is wired
    // to an event handler (`const goHome = () => navigate(...)` +
    // `onClick={goHome}`). The depth counters only catch `handle*`/`on*`-named
    // bindings; this covers idiomatic names like `goHome`/`logout` by usage.
    const isNavigateBindingUsedAsHandler = (callNode: EsTreeNode): boolean => {
      let cursor: EsTreeNode | null | undefined = callNode.parent;
      let enclosingFunction: EsTreeNode | null = null;
      while (cursor) {
        if (isFunctionLike(cursor)) {
          enclosingFunction = cursor;
          break;
        }
        cursor = cursor.parent ?? null;
      }
      if (!enclosingFunction) return false;

      let bindingName: string | null = null;
      if (isNodeOfType(enclosingFunction, "FunctionDeclaration") && enclosingFunction.id) {
        bindingName = enclosingFunction.id.name;
      } else {
        const fnParent = enclosingFunction.parent;
        if (
          isNodeOfType(fnParent, "VariableDeclarator") &&
          isNodeOfType(fnParent.id, "Identifier")
        ) {
          bindingName = fnParent.id.name;
        } else if (
          isNodeOfType(fnParent, "AssignmentExpression") &&
          isNodeOfType(fnParent.left, "Identifier")
        ) {
          bindingName = fnParent.left.name;
        }
      }
      if (!bindingName) return false;
      return getHandlerReferencedNames(callNode).has(bindingName);
    };

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const filename = normalizeFilename(context.filename ?? "");
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;

        if (isDeferredHookCall(node)) deferredCallbackDepth++;

        if (deferredCallbackDepth > 0 || eventHandlerDepth > 0) return;

        if (
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name === "navigate" &&
          (node.arguments?.length ?? 0) > 0
        ) {
          if (isNavigateBindingUsedAsHandler(node)) return;
          context.report({
            node,
            message:
              "navigate() runs during render here, so server and browser output can diverge during hydration.",
          });
        }
      },
      "CallExpression:exit"(node: EsTreeNode) {
        const filename = normalizeFilename(context.filename ?? "");
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isDeferredHookCall(node)) {
          deferredCallbackDepth = Math.max(0, deferredCallbackDepth - 1);
        }
      },
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        const filename = normalizeFilename(context.filename ?? "");
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isEventHandlerAttribute(node)) eventHandlerDepth++;
      },
      "JSXAttribute:exit"(node: EsTreeNode) {
        const filename = normalizeFilename(context.filename ?? "");
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isEventHandlerAttribute(node)) {
          eventHandlerDepth = Math.max(0, eventHandlerDepth - 1);
        }
      },
      Property(node: EsTreeNodeOfType<"Property">) {
        const filename = normalizeFilename(context.filename ?? "");
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isEventHandlerProperty(node)) eventHandlerDepth++;
      },
      "Property:exit"(node: EsTreeNode) {
        const filename = normalizeFilename(context.filename ?? "");
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isEventHandlerProperty(node)) {
          eventHandlerDepth = Math.max(0, eventHandlerDepth - 1);
        }
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        const filename = normalizeFilename(context.filename ?? "");
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isHandlerNamedVariableDeclarator(node)) eventHandlerDepth++;
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        const filename = normalizeFilename(context.filename ?? "");
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isHandlerNamedVariableDeclarator(node)) {
          eventHandlerDepth = Math.max(0, eventHandlerDepth - 1);
        }
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        const filename = normalizeFilename(context.filename ?? "");
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isHandlerNamedFunctionDeclaration(node)) eventHandlerDepth++;
      },
      "FunctionDeclaration:exit"(node: EsTreeNode) {
        const filename = normalizeFilename(context.filename ?? "");
        if (!TANSTACK_ROUTE_FILE_PATTERN.test(filename)) return;
        if (isHandlerNamedFunctionDeclaration(node)) {
          eventHandlerDepth = Math.max(0, eventHandlerDepth - 1);
        }
      },
    };
  },
});
