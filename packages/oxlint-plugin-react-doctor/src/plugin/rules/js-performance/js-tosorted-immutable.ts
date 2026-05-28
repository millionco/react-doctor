import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const jsTosortedImmutable = defineRule<Rule>({
  id: "js-tosorted-immutable",
  tags: ["test-noise"],
  severity: "warn",
  // Hermes (the default React Native / Expo JS engine) hasn't shipped
  // the ES2023 change-array-by-copy methods, so `array.toSorted()`
  // throws `undefined is not a function` at runtime. Recommending it in
  // an RN/Expo project would turn working `[...array].sort()` code into
  // a crash, so the gate drops this rule there. See issue #543.
  disabledBy: ["react-native"],
  recommendation:
    "Use `array.toSorted()` (ES2023) instead of `[...array].sort()` for immutable sorting without the spread allocation",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isMemberProperty(node.callee, "sort")) return;
      const receiver = node.callee.object;
      if (
        isNodeOfType(receiver, "ArrayExpression") &&
        receiver.elements?.length === 1 &&
        isNodeOfType(receiver.elements[0], "SpreadElement")
      ) {
        context.report({
          node,
          message: "[...array].sort() — use array.toSorted() for immutable sorting (ES2023)",
        });
      }
    },
  }),
});
