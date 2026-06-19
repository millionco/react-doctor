import { TIMER_CALLEE_NAMES_REQUIRING_CLEANUP } from "../../constants/dom.js";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import { isSubscribeLikeCallExpression } from "./utils/is-subscribe-like-call-expression.js";

interface ResourceAcquisition {
  readonly node: EsTreeNode;
  readonly resourceName: string;
}

const getTimerAcquisitionName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (!isNodeOfType(node.callee, "Identifier")) return null;
  return TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(node.callee.name) ? node.callee.name : null;
};

const getSubscribeAcquisitionName = (node: EsTreeNode): string | null => {
  if (!isSubscribeLikeCallExpression(node)) return null;
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (!isNodeOfType(node.callee, "MemberExpression")) return null;
  if (!isNodeOfType(node.callee.property, "Identifier")) return null;
  return node.callee.property.name;
};

// Resources acquired synchronously in the effect body (a timer or a
// subscribe-like registration). Mirrors `effect-needs-cleanup`'s notion of
// an acquisition so the two rules agree on what must be cleaned up — this
// one only fires when a cleanup EXISTS but is bypassed on some path.
const collectAcquisitions = (effectBody: EsTreeNode): ResourceAcquisition[] => {
  const acquisitions: ResourceAcquisition[] = [];
  walkInsideStatementBlocks(effectBody, (child) => {
    const timerName = getTimerAcquisitionName(child);
    if (timerName) {
      acquisitions.push({ node: child, resourceName: timerName });
      return;
    }
    const subscribeName = getSubscribeAcquisitionName(child);
    if (subscribeName) acquisitions.push({ node: child, resourceName: subscribeName });
  });
  return acquisitions;
};

const isNullishLiteralOrIdentifier = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "Identifier")) return node.name === "undefined";
  if (isNodeOfType(node, "Literal")) return node.value === null;
  return false;
};

// A `return;` / `return null` / `return undefined` that leaves the effect
// WITHOUT handing React a cleanup function — i.e. a path that skips cleanup.
const isCleanupSkippingReturn = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "ReturnStatement")) return false;
  if (!node.argument) return true;
  return isNullishLiteralOrIdentifier(node.argument as EsTreeNode);
};

// A `return <something>` whose value is a cleanup the effect handed back.
// We treat any non-nullish returned value as a cleanup-bearing path (the
// conservative direction — we only accuse the empty early returns).
const isCleanupBearingReturn = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ReturnStatement") &&
  Boolean(node.argument) &&
  !isNullishLiteralOrIdentifier(node.argument as EsTreeNode);

const collectOwnReturns = (effectBody: EsTreeNode): EsTreeNode[] => {
  const returns: EsTreeNode[] = [];
  walkInsideStatementBlocks(effectBody, (child) => {
    if (isNodeOfType(child, "ReturnStatement")) returns.push(child);
  });
  return returns;
};

export const effectCleanupNotOnEveryPath = defineRule({
  id: "effect-cleanup-not-on-every-path",
  title: "Effect cleanup skipped on some paths",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Acquire the resource AFTER any early `return`, or clean it up on every path. An early `return` that runs after the subscription/timer is created — but before the cleanup is returned — leaks it on that path.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;
      if (
        !isNodeOfType(callback, "ArrowFunctionExpression") &&
        !isNodeOfType(callback, "FunctionExpression")
      ) {
        return;
      }
      if (!isNodeOfType(callback.body, "BlockStatement")) return;

      const acquisitions = collectAcquisitions(callback.body);
      if (acquisitions.length === 0) return;

      const returns = collectOwnReturns(callback.body);
      // Only fire when the effect DOES return a cleanup somewhere — a total
      // absence of cleanup is `effect-needs-cleanup`'s job, not ours.
      if (!returns.some(isCleanupBearingReturn)) return;
      const cleanupSkippingReturns = returns.filter(isCleanupSkippingReturn);
      if (cleanupSkippingReturns.length === 0) return;

      for (const acquisition of acquisitions) {
        const leakingReturn = cleanupSkippingReturns.find((returnStatement) =>
          context.cfg.isReachable(acquisition.node, returnStatement),
        );
        if (!leakingReturn) continue;
        context.report({
          node: acquisition.node,
          message: `\`${acquisition.resourceName}\` is created here, but a later \`return\` exits before the cleanup runs on some path — leaking it. Move the acquisition after that early return, or clean up on every path.`,
        });
        return;
      }
    },
  }),
});
