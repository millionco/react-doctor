import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getCallExpr } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  getUseStateDecl,
  isStateSetter,
  isSyncStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";

// 1:1 port of upstream `src/rules/no-initialize-state.js`.
// Difference vs upstream: upstream uses `context.sourceCode.getText`
// for the diagnostic's "arguments" field; we use
// `stringifyExpressionSnippet` since oxlint plugins don't expose
// source text. Output text matches upstream byte-for-byte on the
// canonical literal / identifier / call shapes; falls back to
// `<expression>` for complex inputs.

export const noInitializeState = defineRule<Rule>({
  id: "no-initialize-state",
  title: "State initialized from a mount effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Pass the initial value directly to useState() instead of setting it from a mount-only useEffect. For SSR hydration, prefer useSyncExternalStore().",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      const isEffectRunOnlyOnMount =
        depsRefs.filter((ref) => !isStateSetter(analysis, ref)).length === 0;
      if (!isEffectRunOnlyOnMount) return;

      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) continue;
        const useStateDecl = getUseStateDecl(analysis, ref);
        if (!useStateDecl || !isNodeOfType(useStateDecl, "VariableDeclarator")) continue;
        if (!isNodeOfType(useStateDecl.id, "ArrayPattern")) continue;
        const elements = useStateDecl.id.elements ?? [];
        const stateBinding = elements[0] ?? elements[1];
        const stateName =
          stateBinding && isNodeOfType(stateBinding, "Identifier") ? stateBinding.name : "<state>";
        context.report({
          node: callExpr,
          message: `Your users see an extra render with empty "${stateName}" because a useEffect sets its starting value.`,
        });
      }
    },
  }),
});
