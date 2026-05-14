import { EFFECT_HOOK_NAMES } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const renderingHydrationNoFlicker = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` or add `suppressHydrationWarning` to the element",
  examples: [
    {
      before:
        "const [mounted, setMounted] = useState(false);\nuseEffect(() => { setMounted(true); }, []);",
      after:
        "const theme = useSyncExternalStore(subscribeToTheme, () => getTheme(), () => 'light');",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;

      const depsNode = node.arguments[1];
      if (!isNodeOfType(depsNode, "ArrayExpression") || depsNode.elements?.length !== 0) return;

      const callback = getEffectCallback(node);
      if (
        !callback ||
        (!isNodeOfType(callback, "ArrowFunctionExpression") &&
          !isNodeOfType(callback, "FunctionExpression"))
      )
        return;

      const bodyStatements = isNodeOfType(callback.body, "BlockStatement")
        ? callback.body.body
        : [callback.body];
      if (!bodyStatements || bodyStatements.length !== 1) return;

      const soleStatement = bodyStatements[0];
      if (
        isNodeOfType(soleStatement, "ExpressionStatement") &&
        isSetterCall(soleStatement.expression)
      ) {
        context.report({
          node,
          message:
            "useEffect(setState, []) on mount causes a flash — consider useSyncExternalStore or suppressHydrationWarning",
        });
      }
    },
  }),
});
