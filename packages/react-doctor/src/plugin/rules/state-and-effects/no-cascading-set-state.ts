import { CASCADING_SET_STATE_THRESHOLD, EFFECT_HOOK_NAMES } from "../../constants.js";
import { countSetStateCalls } from "../../utils/count-set-state-calls.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noCascadingSetState = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "Combine into useReducer: `const [state, dispatch] = useReducer(reducer, initialState)`",
  examples: [
    {
      before:
        "useEffect(() => {\n  setLoading(false);\n  setError(null);\n  setData(payload);\n  setStep(2);\n}, [payload]);",
      after: "dispatch({ type: 'LOADED', payload });",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      const setStateCallCount = countSetStateCalls(callback);
      if (setStateCallCount >= CASCADING_SET_STATE_THRESHOLD) {
        context.report({
          node,
          message: `${setStateCallCount} setState calls in a single useEffect — consider using useReducer or deriving state`,
        });
      }
    },
  }),
});
