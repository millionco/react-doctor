import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { containsFetchCall } from "../../utils/contains-fetch-call.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noFetchInEffect = defineRule<Rule>({
  id: "no-fetch-in-effect",
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "Use `useQuery()` from @tanstack/react-query, `useSWR()`, or fetch in a Server Component instead",
  examples: [
    {
      before:
        "useEffect(() => {\n  fetch('/api/user').then((r) => r.json()).then(setUser);\n}, []);",
      after:
        "const { data: user } = useQuery({ queryKey: ['user'], queryFn: () => fetch('/api/user').then((r) => r.json()) });",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      if (containsFetchCall(callback)) {
        context.report({
          node,
          message:
            "fetch() inside useEffect — use a data fetching library (react-query, SWR) or server component",
        });
      }
    },
  }),
});
