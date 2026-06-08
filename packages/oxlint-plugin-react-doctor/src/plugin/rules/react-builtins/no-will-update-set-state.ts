import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetStateCallInLifecycle } from "../../utils/is-set-state-in-lifecycle.js";
import type { Rule } from "../../utils/rule.js";

const LIFECYCLE_NAMES = new Set(["componentWillUpdate", "UNSAFE_componentWillUpdate"]);
const MESSAGE =
  "Calling setState in componentWillUpdate can trigger another update immediately, loop forever, and freeze the component.";

interface SettingsShape {
  mode?: "allowed" | "disallow-in-func";
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<SettingsShape> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noWillUpdateSetState?: SettingsShape }).noWillUpdateSetState ?? {})
      : {};
  return { mode: ruleSettings.mode ?? "allowed" };
};

// Pre-React-16.3, the `UNSAFE_componentWillUpdate` alias didn't exist —
// methods named that were just regular user methods, not a lifecycle
// hook. OXC's tests reflect this; we honor the version gate too.
const isReactBelow16_3 = (settings: Readonly<Record<string, unknown>> | undefined): boolean => {
  if (!settings || typeof settings !== "object") return false;
  const reactBlock = (settings as { react?: { version?: unknown } }).react;
  if (!reactBlock || typeof reactBlock !== "object") return false;
  const version = reactBlock.version;
  if (typeof version !== "string") return false;
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 16) return true;
  if (major === 16 && minor < 3) return true;
  return false;
};

// Port of `oxc_linter::rules::react::no_will_update_set_state`. Flags
// `this.setState(...)` inside `componentWillUpdate` (or its
// `UNSAFE_componentWillUpdate` form), where it would loop indefinitely.
export const noWillUpdateSetState = defineRule<Rule>({
  id: "no-will-update-set-state",
  title: "setState in componentWillUpdate",
  severity: "warn",
  recommendation:
    "Avoid setState in componentWillUpdate because it can loop forever; derive state before render or move guarded updates to componentDidUpdate.",
  create: (context) => {
    const { mode } = resolveSettings(context.settings);
    const skipUnsafePrefix = isReactBelow16_3(context.settings);
    const activeLifecycleNames = skipUnsafePrefix
      ? new Set(["componentWillUpdate"])
      : LIFECYCLE_NAMES;

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
        const shouldFlag = isSetStateCallInLifecycle(node, activeLifecycleNames, {
          disallowInNestedFunctions: mode === "disallow-in-func",
        });
        if (!shouldFlag) return;
        context.report({ node: node.callee, message: MESSAGE });
      },
    };
  },
});
