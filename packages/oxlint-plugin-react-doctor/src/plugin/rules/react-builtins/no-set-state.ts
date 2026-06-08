import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getParentComponent } from "../../utils/get-parent-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "`this.setState` keeps local class state in a project that forbids it, so state ownership becomes harder to reason about.";

// Port of `oxc_linter::rules::react::no_set_state`. Style rule for
// architectures (Flux-like) that forbid local component state — flags
// `this.setState(...)` only when inside an es5/es6 React component.
export const noSetState = defineRule<Rule>({
  id: "no-set-state",
  title: "Local class state forbidden",
  severity: "warn",
  // Effectively a "no class components" rule — `this.setState` is the
  // canonical class-component API and class components remain valid
  // React. Real codebases still use them for error boundaries,
  // legacy code, third-party integrations. Default off; opt in when
  // migrating away from class components on purpose.
  defaultEnabled: false,
  recommendation:
    "Lift state up or use an external store so class-local state does not hide ownership.",
  category: "Architecture",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (!isNodeOfType(node.callee.object, "ThisExpression")) return;
      if (
        !isNodeOfType(node.callee.property, "Identifier") ||
        node.callee.property.name !== "setState"
      ) {
        return;
      }
      if (!getParentComponent(node)) return;
      context.report({ node: node.callee, message: MESSAGE });
    },
  }),
});
