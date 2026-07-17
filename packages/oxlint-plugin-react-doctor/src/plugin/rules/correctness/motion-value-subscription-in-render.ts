import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getMotionReactApiPath } from "../../utils/get-motion-react-api-path.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MOTION_VALUE_HOOKS: ReadonlySet<string> = new Set([
  "useMotionTemplate",
  "useMotionValue",
  "useSpring",
  "useTime",
  "useTransform",
  "useVelocity",
]);

const isMotionValueExpression = (
  rawNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const node = stripParenExpression(rawNode);
  if (isNodeOfType(node, "CallExpression")) {
    const apiPath = getMotionReactApiPath(node.callee, scopes);
    return Boolean(apiPath && MOTION_VALUE_HOOKS.has(apiPath));
  }
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.symbolFor(node);
  if (symbol?.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isMotionValueExpression(symbol.initializer, scopes, visitedSymbolIds);
};

export const motionValueSubscriptionInRender = defineRule({
  id: "motion-value-subscription-in-render",
  title: "Motion value subscription is created during render",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Subscribe with useMotionValueEvent, or create the subscription in an effect and return its cleanup function.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        getStaticPropertyName(node.callee) !== "on" ||
        !isMotionValueExpression(node.callee.object, context.scopes, new Set<number>()) ||
        !findRenderPhaseComponentOrHook(node, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This Motion value subscription is added during render, so re-renders can accumulate listeners. Use useMotionValueEvent() or subscribe inside an effect with cleanup.",
      });
    },
  }),
});
