import { defineRule } from "../../utils/define-rule.js";
import { getParentComponent } from "../../utils/get-parent-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Port of `oxc_linter::rules::react::no_is_mounted`. Flags a
// `this.isMounted()` call only when it sits inside an actual React
// component (an es5 `createReactClass` factory or an es6 `class extends
// Component`). A plain class that happens to expose an `isMounted`
// method — e.g. a connection pool — is not a React component and is
// left alone.
export const noIsMounted = defineRule({
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
      if (!getParentComponent(node)) return;
      context.report({
        node,
        message:
          "`isMounted` is unreliable in modern React, so async callbacks can update state after unmount.",
      });
    },
  }),
});
