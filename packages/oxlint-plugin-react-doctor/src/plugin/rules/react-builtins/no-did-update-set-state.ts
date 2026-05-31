import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetStateCallInLifecycle } from "../../utils/is-set-state-in-lifecycle.js";
import type { Rule } from "../../utils/rule.js";

const LIFECYCLE_NAMES = new Set(["componentDidUpdate"]);
const MESSAGE = "This can loop forever & freeze the component.";

interface SettingsShape {
  mode?: "allowed" | "disallow-in-func";
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<SettingsShape> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noDidUpdateSetState?: SettingsShape }).noDidUpdateSetState ?? {})
      : {};
  return { mode: ruleSettings.mode ?? "allowed" };
};

// Port of `oxc_linter::rules::react::no_did_update_set_state`. Flags
// `this.setState(...)` inside `componentDidUpdate`. With
// `mode: "disallow-in-func"`, also flags nested-function call sites.
export const noDidUpdateSetState = defineRule<Rule>({
  id: "no-did-update-set-state",
  title: "setState in componentDidUpdate",
  severity: "warn",
  recommendation:
    "Setting state in `componentDidUpdate` causes another render and can loop. Use `getDerivedStateFromProps` instead.",
  create: (context) => {
    const { mode } = resolveSettings(context.settings);
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        if (!isNodeOfType(node.callee.object, "ThisExpression")) return;
        if (
          !isNodeOfType(node.callee.property, "Identifier") ||
          node.callee.property.name !== "setState"
        ) {
          return;
        }
        const shouldFlag = isSetStateCallInLifecycle(node, LIFECYCLE_NAMES, {
          disallowInNestedFunctions: mode === "disallow-in-func",
        });
        if (!shouldFlag) return;
        context.report({ node: node.callee, message: MESSAGE });
      },
    };
  },
});
