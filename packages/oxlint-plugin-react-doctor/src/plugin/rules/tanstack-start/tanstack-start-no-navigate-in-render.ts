import {
  EFFECT_HOOK_NAMES,
  HANDLER_FUNCTION_NAME_PATTERN,
  HOOK_NAME_PATTERN,
  REACT_HANDLER_PROP_PATTERN,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import {
  getFunctionBindingIdentifier,
  getFunctionBindingName,
} from "../../utils/get-function-binding-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isInProjectDirectory } from "../../utils/is-in-project-directory.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const PROMISE_CONTINUATION_METHODS = new Set(["then", "catch", "finally"]);

// Hooks whose function-typed first argument runs synchronously DURING render
// (useState lazy initializer, useSyncExternalStore getSnapshot) — a navigate()
// inside them is still a render-time side effect.
const RENDER_SYNCHRONOUS_HOOK_NAMES = new Set(["useState", "useSyncExternalStore"]);

export const tanstackStartNoNavigateInRender = defineRule({
  id: "tanstack-start-no-navigate-in-render",
  title: "navigate() called during render",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  recommendation:
    "Use `throw redirect({ to: '/path' })` in `beforeLoad` or `loader`. navigate() during render causes hydration issues.",
  create: (context: RuleContext): RuleVisitors => {
    if (!isInProjectDirectory(context, "routes")) return {};

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

    // True when `functionNode` is a callback the surrounding code runs LATER:
    // the function-typed first argument of a `use*` custom hook
    // (`useInterval(() => navigate(...), 1000)`) — excluding hooks whose
    // callback runs synchronously during render (useState lazy initializer,
    // useSyncExternalStore getSnapshot) — or a promise continuation
    // (`.then`/`.catch`/`.finally`).
    const isDeferredCallbackPosition = (functionNode: EsTreeNode): boolean => {
      const callParent = functionNode.parent;
      if (!isNodeOfType(callParent, "CallExpression")) return false;
      if (callParent.callee === functionNode) return false;

      if (
        isNodeOfType(callParent.callee, "MemberExpression") &&
        !callParent.callee.computed &&
        isNodeOfType(callParent.callee.property, "Identifier") &&
        PROMISE_CONTINUATION_METHODS.has(callParent.callee.property.name)
      ) {
        return true;
      }

      return (
        isNodeOfType(callParent.callee, "Identifier") &&
        HOOK_NAME_PATTERN.test(callParent.callee.name) &&
        !RENDER_SYNCHRONOUS_HOOK_NAMES.has(callParent.callee.name) &&
        callParent.arguments?.[0] === functionNode
      );
    };

    const isEventHandlerAttribute = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "JSXAttribute") &&
      isNodeOfType(node.name, "JSXIdentifier") &&
      REACT_HANDLER_PROP_PATTERN.test(node.name.name);

    const isEventHandlerNamedProperty = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "Property") &&
      ((isNodeOfType(node.key, "Identifier") &&
        typeof node.key.name === "string" &&
        REACT_HANDLER_PROP_PATTERN.test(node.key.name)) ||
        (isNodeOfType(node.key, "Literal") &&
          typeof node.key.value === "string" &&
          REACT_HANDLER_PROP_PATTERN.test(node.key.value)));

    const isEventHandlerProperty = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "Property") &&
      isFunctionLike(node.value) &&
      isEventHandlerNamedProperty(node);

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

    const isInsideEventHandlerValue = (identifier: EsTreeNode): boolean => {
      let cursor: EsTreeNode | null | undefined = identifier.parent;
      while (cursor) {
        if (isEventHandlerAttribute(cursor)) return true;
        if (isEventHandlerNamedProperty(cursor)) return true;
        cursor = cursor.parent ?? null;
      }
      return false;
    };

    // True when `functionNode`'s own binding is wired to an event handler
    // (`const goHome = () => navigate(...)` + `onClick={goHome}` or
    // `useForm({ onSubmit: goHome })`). Scope-aware: only references that
    // resolve to THIS binding count, so an unrelated same-named identifier
    // in another scope never suppresses.
    const isWiredAsEventHandler = (functionNode: EsTreeNode): boolean => {
      const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
      if (!bindingIdentifier) return false;
      const bindingSymbol = context.scopes.symbolFor(bindingIdentifier);
      if (!bindingSymbol) return false;
      return bindingSymbol.references.some((reference) =>
        isInsideEventHandlerValue(reference.identifier),
      );
    };

    // True when `functionNode` is a closure that a custom hook RETURNS —
    // explicitly (`return () => navigate(...)`) or as an implicit arrow
    // return (`export const useLogout = () => () => navigate(...)`). The
    // returned function is the caller's deferred handler, not render-time
    // code, so it must not be flagged.
    const isReturnedFromCustomHook = (functionNode: EsTreeNode): boolean => {
      const parent = functionNode.parent;
      if (isNodeOfType(parent, "ReturnStatement")) {
        const outerFunction = findEnclosingFunction(parent);
        const hookName = outerFunction ? getFunctionBindingName(outerFunction) : null;
        return Boolean(hookName && HOOK_NAME_PATTERN.test(hookName));
      }
      if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === functionNode) {
        const hookName = getFunctionBindingName(parent);
        return Boolean(hookName && HOOK_NAME_PATTERN.test(hookName));
      }
      return false;
    };

    // Anonymous wrappers the surrounding code invokes synchronously — an
    // IIFE callee or a callback argument (`startTransition(() => ...)`,
    // `items.forEach(item => ...)`). They add no deferral of their own, so
    // the climb looks through them to the next enclosing function.
    const isSynchronouslyInvokedAnonymousWrapper = (functionNode: EsTreeNode): boolean => {
      if (getFunctionBindingIdentifier(functionNode)) return false;
      const parent = functionNode.parent;
      if (!isNodeOfType(parent, "CallExpression")) return false;
      return (
        parent.callee === functionNode ||
        (parent.arguments ?? []).some((callArgument) => callArgument === functionNode)
      );
    };

    // Climbs the enclosing functions of a navigate() call from innermost to
    // outermost, looking through synchronously-invoked anonymous wrappers,
    // until a function is deferred (hook callback / promise continuation),
    // wired as an event handler, or returned from a custom hook — or until a
    // named binding / component proves the call is on the render path.
    const isDeferredNavigateCall = (callNode: EsTreeNode): boolean => {
      let enclosingFunction = findEnclosingFunction(callNode);
      while (enclosingFunction) {
        if (isDeferredCallbackPosition(enclosingFunction)) return true;
        if (isWiredAsEventHandler(enclosingFunction)) return true;
        if (isReturnedFromCustomHook(enclosingFunction)) return true;
        if (!isSynchronouslyInvokedAnonymousWrapper(enclosingFunction)) return false;
        enclosingFunction = findEnclosingFunction(enclosingFunction);
      }
      return false;
    };

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isDeferredHookCall(node)) deferredCallbackDepth++;

        if (deferredCallbackDepth > 0 || eventHandlerDepth > 0) return;

        if (
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name === "navigate" &&
          (node.arguments?.length ?? 0) > 0
        ) {
          if (isDeferredNavigateCall(node)) return;
          context.report({
            node,
            message:
              "navigate() runs during render here, so server and browser output can diverge during hydration.",
          });
        }
      },
      "CallExpression:exit"(node: EsTreeNode) {
        if (isDeferredHookCall(node)) {
          deferredCallbackDepth = Math.max(0, deferredCallbackDepth - 1);
        }
      },
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (isEventHandlerAttribute(node)) eventHandlerDepth++;
      },
      "JSXAttribute:exit"(node: EsTreeNode) {
        if (isEventHandlerAttribute(node)) {
          eventHandlerDepth = Math.max(0, eventHandlerDepth - 1);
        }
      },
      Property(node: EsTreeNodeOfType<"Property">) {
        if (isEventHandlerProperty(node)) eventHandlerDepth++;
      },
      "Property:exit"(node: EsTreeNode) {
        if (isEventHandlerProperty(node)) {
          eventHandlerDepth = Math.max(0, eventHandlerDepth - 1);
        }
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (isHandlerNamedVariableDeclarator(node)) eventHandlerDepth++;
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (isHandlerNamedVariableDeclarator(node)) {
          eventHandlerDepth = Math.max(0, eventHandlerDepth - 1);
        }
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (isHandlerNamedFunctionDeclaration(node)) eventHandlerDepth++;
      },
      "FunctionDeclaration:exit"(node: EsTreeNode) {
        if (isHandlerNamedFunctionDeclaration(node)) {
          eventHandlerDepth = Math.max(0, eventHandlerDepth - 1);
        }
      },
    };
  },
});
