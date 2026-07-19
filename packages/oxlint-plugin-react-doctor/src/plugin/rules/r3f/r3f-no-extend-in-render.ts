import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";

export const r3fNoExtendInRender = defineRule({
  id: "r3f-no-extend-in-render",
  title: "R3F catalogue extension during render",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Call extend at module scope so React renders and Strict Mode replays do not repeatedly mutate R3F's global catalogue",
  requires: ["r3f:3"],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = stripParenExpression(node.callee);
      const calleeSymbol = isNodeOfType(callee, "Identifier")
        ? context.scopes.symbolFor(callee)
        : null;
      if (
        !isR3fApiCall(node, "extend", context.scopes) ||
        (calleeSymbol && hasSymbolWriteBefore(calleeSymbol, node, context.scopes)) ||
        !findRenderPhaseComponentOrHook(node, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This extend call runs during React render and mutates R3F's global catalogue again on every execution. Move the registration to module scope",
      });
    },
  }),
});
