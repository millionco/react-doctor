import { TIMER_CALLEE_NAMES_REQUIRING_CLEANUP } from "../../constants/dom.js";
import { EFFECT_HOOK_NAMES, SUBSCRIPTION_METHOD_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isSubscribeLikeCallExpression } from "./utils/is-subscribe-like-call-expression.js";
import { isCleanupReturn } from "./utils/is-cleanup-return.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: From "Lifecycle of Reactive Effects":
//
//   "Each Effect describes a separate synchronization process. When
//    the component is removed, your Effect needs to stop synchronizing.
//    The cleanup function should stop or undo whatever the Effect was
//    doing."
//
// An effect that adds a listener / subscribes / sets a timer but
// returns no cleanup leaks memory and triggers React's "you forgot
// to clean up an effect" StrictMode hint at runtime. We flag it
// statically. Three subscribe-shaped families:
//   - addEventListener (browser DOM, EventTarget-shaped libs)
//   - subscribe / addListener / on / watch / listen / sub
//   - setInterval / setTimeout (without explicit clear)
//
// The subscribe / unsubscribe method allowlists live in `constants.ts`
// (`SUBSCRIPTION_METHOD_NAMES`, `UNSUBSCRIPTION_METHOD_NAMES`) so the
// cleanup-needed detector and the prefer-use-sync-external-store
// detector share a single source of truth. Inline duplicates would
// silently drift out of sync as new library shapes get added.
interface SubscribeLikeUsage {
  kind: "subscribe" | "timer";
  resourceName: string;
}

const findSubscribeLikeUsages = (callback: EsTreeNode): SubscribeLikeUsage[] => {
  const usages: SubscribeLikeUsage[] = [];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return usages;
  }
  // HACK: timer/subscribe calls inside the EFFECT'S CLEANUP RETURN
  // are not new registrations — they're the disposal step. The old
  // walker traversed the full callback including any returned
  // cleanup function, so a `setTimeout` inside `return () => { ... }`
  // got counted as a usage. Detect and skip the cleanup ReturnStatement's
  // argument body during the walk.
  let cleanupArgument: EsTreeNode | null = null;
  if (isNodeOfType(callback.body, "BlockStatement")) {
    const callbackStatements = callback.body.body ?? [];
    const lastCallbackStatement = callbackStatements[callbackStatements.length - 1];
    if (isNodeOfType(lastCallbackStatement, "ReturnStatement") && lastCallbackStatement.argument) {
      cleanupArgument = lastCallbackStatement.argument;
    }
  }

  walkAst(callback, (child: EsTreeNode) => {
    if (child === cleanupArgument) return false;
    if (!isNodeOfType(child, "CallExpression")) return;

    if (
      isNodeOfType(child.callee, "Identifier") &&
      TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(child.callee.name)
    ) {
      usages.push({
        kind: "timer",
        resourceName: child.callee.name,
      });
      return;
    }

    if (
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      SUBSCRIPTION_METHOD_NAMES.has(child.callee.property.name)
    ) {
      usages.push({
        kind: "subscribe",
        resourceName: child.callee.property.name,
      });
    }
  });
  return usages;
};

// HACK: variables bound to a subscribe-like or timer-like call inside
// an effect body are CLEANUP TARGETS — `return X` or `() => X()` /
// `() => clearTimeout(X)` releases the resource. Collecting them here
// lets the shared release predicate accept user-named bindings
// (`const unsub = ...; return unsub`) without falling back to the
// previous "any Identifier is fine" behavior.
const collectReleasableBindingNames = (effectCallback: EsTreeNode): Set<string> => {
  const releasableNames = new Set<string>();
  if (
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
    !isNodeOfType(effectCallback, "FunctionExpression")
  ) {
    return releasableNames;
  }
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) return releasableNames;
  for (const statement of effectCallback.body.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      const init = declarator.init;
      if (!init || !isNodeOfType(init, "CallExpression")) continue;
      if (isSubscribeLikeCallExpression(init)) {
        releasableNames.add(declarator.id.name);
        continue;
      }
      if (
        isNodeOfType(init.callee, "Identifier") &&
        TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(init.callee.name)
      ) {
        releasableNames.add(declarator.id.name);
      }
    }
  }
  return releasableNames;
};

const effectHasCleanupRelease = (callback: EsTreeNode): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return false;
  }
  // HACK: expression-body arrows are the dominant shape for trivial
  // subscribe-only effects:
  //
  //   useEffect(() => store.subscribe(handler), []);
  //
  // The arrow's expression body IS the body, and its evaluation
  // result is implicitly returned as the effect's cleanup function.
  // For subscribe-shaped calls we know the return value is the
  // unsubscribe — accept this case before the BlockStatement-only
  // checks below.
  if (!isNodeOfType(callback.body, "BlockStatement")) {
    return isSubscribeLikeCallExpression(callback.body);
  }
  const knownBoundReleaseNames = collectReleasableBindingNames(callback);
  // HACK: scan ALL `return` statements at the effect's own function
  // scope (skipping nested functions via `walkInsideStatementBlocks`),
  // not just the top-level last statement. The last-statement check
  // false-positives on the very common conditional-cleanup shape:
  //
  //   useEffect(() => {
  //     if (!enabled) return;
  //     const sub = subscribe(...);
  //     if (someCondition) {
  //       return () => sub();
  //     }
  //   }, [enabled]);
  //
  // Either accept the conditional cleanup as intentional, or risk
  // ~36% FPs on real codebases (measured: react-grab, excalidraw,
  // textarea/popover patterns). Accepting nested cleanup mirrors how
  // exhaustive-deps treats branched returns: trust the author.
  let didFindCleanupReturn = false;
  walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
    if (didFindCleanupReturn) return;
    if (!isNodeOfType(child, "ReturnStatement")) return;
    if (isCleanupReturn(child.argument, knownBoundReleaseNames)) {
      didFindCleanupReturn = true;
    }
  });
  return didFindCleanupReturn;
};

export const effectNeedsCleanup = defineRule<Rule>({
  id: "effect-needs-cleanup",
  severity: "error",
  recommendation:
    "Return a cleanup function that releases the subscription / timer: `return () => target.removeEventListener(name, handler)` for listeners, `return () => clearInterval(id)` / `clearTimeout(id)` for timers, or `return unsubscribe` if the subscribe call already returned one",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      const usages = findSubscribeLikeUsages(callback);
      if (usages.length === 0) return;

      if (effectHasCleanupRelease(callback)) return;

      const firstUsage = usages[0];
      const verb = firstUsage.kind === "timer" ? "schedules" : "subscribes via";
      const release =
        firstUsage.kind === "timer"
          ? `clear${firstUsage.resourceName === "setInterval" ? "Interval" : "Timeout"}(...)`
          : "the matching remove/unsubscribe call";
      context.report({
        node,
        message: `useEffect ${verb} \`${firstUsage.resourceName}(...)\` but never returns a cleanup — leaks the registration on every re-run and on unmount. Return a cleanup function that calls ${release}`,
      });
    },
  }),
});
