import {
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  TIMER_CLEANUP_CALLEE_NAMES,
} from "../../constants/dom.js";
import {
  BOUND_RESOURCE_RELEASE_METHOD_NAMES,
  EFFECT_HOOK_NAMES,
  GLOBAL_RELEASE_METHOD_NAMES,
  SUBSCRIPTION_METHOD_NAMES,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { ResourceEvent, TypestateAutomaton } from "@react-doctor/cfg";

// A pure leak detector: a resource acquired in this function can rest in the
// `opened` state on a normal-completion path. No error states — only the
// leak matters — so it never accuses legal protocol use.
const RESOURCE_AUTOMATON: TypestateAutomaton = {
  initial: "initial",
  transition: (state, event) => {
    if (event === "open") return "opened";
    if (event === "close") return state === "opened" ? "closed" : state;
    return state;
  },
  errorStates: new Set(),
  acceptingStates: new Set(["initial", "closed"]),
};

// Member-call release methods that pair with a variable-bound open
// (`sub.unsubscribe()`, `controller.abort()`). The DOM listener pair is
// handled separately, keyed structurally, so its methods are excluded here.
const RECEIVER_RELEASE_METHODS = new Set(
  [...GLOBAL_RELEASE_METHOD_NAMES, ...BOUND_RESOURCE_RELEASE_METHOD_NAMES].filter(
    (name) => name !== "removeEventListener" && name !== "removeListener",
  ),
);
// Subscribe-shaped open methods, minus the DOM listener registrars.
const SUBSCRIBE_OPEN_METHODS = new Set(
  [...SUBSCRIPTION_METHOD_NAMES].filter(
    (name) => name !== "addEventListener" && name !== "addListener",
  ),
);
const LISTENER_ADD_METHODS = new Set(["addEventListener", "addListener"]);
const LISTENER_REMOVE_METHODS = new Set(["removeEventListener", "removeListener"]);

const memberPropertyName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "MemberExpression")) return null;
  if (node.computed || !isNodeOfType(node.property, "Identifier")) return null;
  return node.property.name;
};

// The variable a resource-producing call is stored into — the resource's
// identity. Only a direct `const x = …` / `x = …` gives a trackable name.
const assignedVariableName = (node: EsTreeNode): string | null => {
  const parent = node.parent;
  if (!parent) return null;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id.name;
  }
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.operator === "=" &&
    isNodeOfType(parent.left, "Identifier")
  ) {
    return parent.left.name;
  }
  return null;
};

// A stable structural key for a listener registration's (target, type,
// handler) triple, so `addEventListener`/`removeEventListener` on the same
// arguments pair up. Null when any operand is too complex to key reliably
// (so the listener is simply not tracked — no false leak).
const expressionKey = (node: EsTreeNode | undefined): string | null => {
  if (!node) return null;
  if (isNodeOfType(node, "Identifier")) return `i:${node.name}`;
  if (isNodeOfType(node, "ThisExpression")) return "this";
  if (isNodeOfType(node, "Literal")) return `l:${String(node.value)}`;
  if (isNodeOfType(node, "MemberExpression") && !node.computed) {
    const object = expressionKey(node.object as EsTreeNode);
    const property = memberPropertyName(node);
    return object && property ? `${object}.${property}` : null;
  }
  return null;
};

const listenerKey = (
  callee: EsTreeNodeOfType<"MemberExpression">,
  call: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const target = expressionKey(callee.object as EsTreeNode);
  const type = expressionKey(call.arguments[0] as EsTreeNode | undefined);
  const handler = expressionKey(call.arguments[1] as EsTreeNode | undefined);
  return target && type && handler ? `evt:${target}|${type}|${handler}` : null;
};

// Classify a single call / new expression as a resource open or close, or
// null when it is neither.
const classifyCall = (node: EsTreeNode): ResourceEvent | null => {
  if (isNodeOfType(node, "NewExpression")) {
    if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "AbortController") {
      const name = assignedVariableName(node);
      return name ? { resource: `var:${name}`, event: "open", node } : null;
    }
    return null;
  }
  if (!isNodeOfType(node, "CallExpression")) return null;

  if (isNodeOfType(node.callee, "Identifier")) {
    if (TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(node.callee.name)) {
      const name = assignedVariableName(node);
      return name ? { resource: `var:${name}`, event: "open", node } : null;
    }
    if (TIMER_CLEANUP_CALLEE_NAMES.has(node.callee.name)) {
      const argument = node.arguments[0] as EsTreeNode | undefined;
      if (argument && isNodeOfType(argument, "Identifier")) {
        return { resource: `var:${argument.name}`, event: "close", node };
      }
    }
    return null;
  }

  const method = memberPropertyName(node.callee);
  if (!method || !isNodeOfType(node.callee, "MemberExpression")) return null;

  if (LISTENER_ADD_METHODS.has(method)) {
    const key = listenerKey(node.callee, node);
    return key ? { resource: key, event: "open", node } : null;
  }
  if (LISTENER_REMOVE_METHODS.has(method)) {
    const key = listenerKey(node.callee, node);
    return key ? { resource: key, event: "close", node } : null;
  }
  if (SUBSCRIBE_OPEN_METHODS.has(method)) {
    const name = assignedVariableName(node);
    return name ? { resource: `var:${name}`, event: "open", node } : null;
  }
  if (RECEIVER_RELEASE_METHODS.has(method) && isNodeOfType(node.callee.object, "Identifier")) {
    return { resource: `var:${node.callee.object.name}`, event: "close", node };
  }
  return null;
};

// All resource events inside a subtree, stopping at nested function
// boundaries (each function owns its own CFG / resource scope).
const collectEventsIn = (root: EsTreeNode): ResourceEvent[] => {
  const events: ResourceEvent[] = [];
  walkAst(root, (node) => {
    if (node !== root && isFunctionLike(node)) return false;
    const event = classifyCall(node);
    if (event) events.push(event);
  });
  return events;
};

// True when `node` sits inside a `try`'s `finally` block. The CFG models
// try/finally coarsely (a `return` in `try` routes straight to the exit
// rather than through the finalizer), so a finally-based release would look
// like a leak. But `finally` runs on every path by language semantics, so a
// resource released there is never actually leaked.
const isInFinallyBlock = (node: EsTreeNode): boolean => {
  let child: EsTreeNode = node;
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isNodeOfType(current, "TryStatement") && current.finalizer === child) return true;
    child = current;
    current = current.parent ?? null;
  }
  return false;
};

const isNullishReturnArgument = (argument: EsTreeNode): boolean => {
  if (isNodeOfType(argument, "Identifier")) return argument.name === "undefined";
  if (isNodeOfType(argument, "Literal")) return argument.value === null;
  return false;
};

// True when the effect hands React a cleanup on some path — a `return
// <non-nullish>` at the top level of the callback (not inside a nested
// function). That unmount / re-run release contract is owned by
// `effect-cleanup-not-on-every-path`; its release sits in a nested closure
// this rule cannot see, so any inline acquire/release alongside it is a
// defensive remove-then-add idiom, not a leak. Deferring here is what keeps
// the two rules from double-reporting.
const effectReturnsCleanup = (root: EsTreeNode): boolean => {
  let returnsCleanup = false;
  walkAst(root, (node) => {
    if (returnsCleanup || (node !== root && isFunctionLike(node))) return false;
    if (
      isNodeOfType(node, "ReturnStatement") &&
      node.argument &&
      !isNullishReturnArgument(node.argument as EsTreeNode)
    ) {
      returnsCleanup = true;
      return false;
    }
  });
  return returnsCleanup;
};

// React effect hooks whose callback bodies own inline resource cleanup.
// Covers `useInsertionEffect` on top of the shared effect set, and the
// namespaced `React.useEffect` / `React.useLayoutEffect` forms resolve through
// `isHookCall` → `getCalleeName`'s member-expression handling.
const EFFECT_CALLBACK_HOOK_NAMES = new Set<string>([...EFFECT_HOOK_NAMES, "useInsertionEffect"]);

const isEffectCallback = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent;
  return Boolean(
    parent &&
    isHookCall(parent, EFFECT_CALLBACK_HOOK_NAMES) &&
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments[0] === functionNode,
  );
};

export const noUnreleasedResource = defineRule({
  id: "no-unreleased-resource",
  title: "Effect resource released inline on some paths but leaked on others",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Release the resource on every path inside the effect. A timer, subscription, AbortController, or event listener you clear inline on some branches but skip on an early return leaks on that path. Move the early return before the acquisition, or return a cleanup function instead.",
  create: (context: RuleContext) => {
    // Scope: React effect callbacks only. The general open/close leak signal
    // is too noisy outside effects — class lifecycle methods release in a
    // sibling `dispose()` and non-React frameworks use their own cleanup
    // registration (Solid's `onCleanup`), neither visible to a single CFG.
    // Within an effect this catches an INLINE acquire/release pair bypassed by
    // an early return. The returned-cleanup contract is owned by
    // `effect-cleanup-not-on-every-path`, so when the effect returns a cleanup
    // we defer entirely — its release lives in a nested closure this rule
    // can't see, so an inline acquire/release alongside it (the defensive
    // remove-then-add idiom) is not a leak.
    const checkEffectCallback = (node: EsTreeNode): void => {
      if (!isEffectCallback(node)) return;
      if (effectReturnsCleanup(node)) return;

      const events = collectEventsIn(node);
      const closedResources = new Set<string>();
      const finallyClosedResources = new Set<string>();
      for (const event of events) {
        if (event.event !== "close") continue;
        closedResources.add(event.resource);
        if (isInFinallyBlock(event.node)) finallyClosedResources.add(event.resource);
      }
      // Only flag a PARTIAL leak — a resource the author closes somewhere,
      // proving intent, but misses on a path. A resource never closed at all
      // is a different (and noisier) signal we deliberately leave alone.
      if (closedResources.size === 0) return;

      const violations = context.typestate.verify(node, {
        automaton: RESOURCE_AUTOMATON,
        classifier: collectEventsIn,
      });

      for (const violation of violations) {
        if (violation.kind !== "leaked-resource") continue;
        if (!closedResources.has(violation.resource)) continue;
        // A finally-released resource runs on every path — never leaked.
        if (finallyClosedResources.has(violation.resource)) continue;
        context.report({
          node: violation.node,
          message:
            "This effect resource is released inline on some paths but not all, so an early return leaks it. Release it on every path, or return a cleanup function.",
        });
      }
    };

    return {
      FunctionExpression: checkEffectCallback,
      ArrowFunctionExpression: checkEffectCallback,
    };
  },
});
