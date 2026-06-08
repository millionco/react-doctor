import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

// Port of `oxc_linter::rules::react::no_is_mounted`. Mirrors the Rust
// rule's behavior: flags a `this.isMounted()` call only when it sits
// inside a method (class `MethodDefinition`) or an object property
// callback (TSESTree `Property` value), since those are the React
// component shapes the rule cares about. A bare `this.isMounted()` at
// module scope is left alone.
export const noIsMounted = defineRule<Rule>({
  id: "no-is-mounted",
  title: "isMounted lets async callbacks update after unmount",
  severity: "warn",
  recommendation:
    "`isMounted` doesn't work in modern React. Track mount state with a ref, or cancel the async work instead.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (!isNodeOfType(node.callee.object, "ThisExpression")) return;
      if (
        !isNodeOfType(node.callee.property, "Identifier") ||
        node.callee.property.name !== "isMounted"
      ) {
        return;
      }

      let ancestor = node.parent;
      while (ancestor) {
        if (ancestor.type === "MethodDefinition" || ancestor.type === "Property") {
          context.report({
            node,
            message:
              "`isMounted` is unreliable in modern React, so async callbacks can update state after unmount.",
          });
          return;
        }
        ancestor = ancestor.parent ?? null;
      }
    },
  }),
});
