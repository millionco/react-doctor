import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noEffectEventHandler = defineRule<Rule>({
  id: "no-effect-event-handler",
  severity: "warn",
  recommendation:
    "Move the conditional logic into onClick, onChange, or onSubmit handlers directly",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      const depsNode = node.arguments[1];
      if (!isNodeOfType(depsNode, "ArrayExpression") || !depsNode.elements?.length) return;

      const dependencyNames = new Set<string>();
      for (const element of depsNode.elements ?? []) {
        if (isNodeOfType(element, "Identifier")) dependencyNames.add(element.name);
      }

      const statements = getCallbackStatements(callback);
      if (statements.length !== 1) return;

      const soleStatement = statements[0];
      if (!isNodeOfType(soleStatement, "IfStatement")) return;

      // HACK: §5 of "You Might Not Need an Effect" uses
      // `if (product.isInCart)` — a MemberExpression, not a bare
      // Identifier. The earlier detector hard-required `Identifier`
      // and missed the article's literal example. Walk the test
      // down to its root identifier so both shapes match:
      //   if (isOpen)            → root = "isOpen"
      //   if (product.isInCart)  → root = "product"
      const rootIdentifierName = getRootIdentifierName(soleStatement.test);
      if (!rootIdentifierName || !dependencyNames.has(rootIdentifierName)) return;

      // Don't defer to `noEventTriggerState` here. The previous
      // implementation tried to ("if the body looks event-shaped,
      // let the more specific rule report"), but that deference
      // could silently drop diagnostics: `noEventTriggerState`
      // requires several preconditions this visitor can't cheaply
      // verify (single dep, handler-only writes for that state,
      // and not render-reachable). When any of those failed, the
      // narrow rule didn't fire AND this rule deferred, so the
      // user got nothing. Both rules fire independently — the two
      // messages frame the same code differently ("this useEffect
      // simulates a handler" vs "this state exists only to schedule
      // X from an effect") and a duplicate diagnostic is strictly
      // better than a silent drop.
      context.report({
        node,
        message:
          "useEffect simulating an event handler — move logic to an actual event handler instead",
      });
    },
  }),
});
