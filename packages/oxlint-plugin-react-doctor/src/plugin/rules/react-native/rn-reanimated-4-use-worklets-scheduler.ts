import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveReanimatedApiName } from "./utils/resolve-reanimated-api-name.js";

const WORKLETS_REPLACEMENT_BY_REANIMATED_API = new Map<string, string>([
  ["runOnUI", "scheduleOnUI"],
  ["runOnJS", "scheduleOnRN"],
  ["executeOnUIRuntimeSync", "runOnUISync"],
  ["runOnRuntime", "scheduleOnRuntime"],
]);

const REANIMATED_SCHEDULER_API_NAMES: ReadonlySet<string> = new Set(
  WORKLETS_REPLACEMENT_BY_REANIMATED_API.keys(),
);

export const rnReanimated4UseWorkletsScheduler = defineRule({
  id: "rn-reanimated-4-use-worklets-scheduler",
  title: "Scheduler moved to Worklets",
  tags: ["migration-hint"],
  requires: ["reanimated:4"],
  severity: "warn",
  recommendation:
    "Import the corresponding scheduler from `react-native-worklets` when migrating to Reanimated 4.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const apiName = resolveReanimatedApiName(
        node,
        context.scopes,
        REANIMATED_SCHEDULER_API_NAMES,
      );
      if (!apiName) return;
      const replacementName = WORKLETS_REPLACEMENT_BY_REANIMATED_API.get(apiName);
      if (!replacementName) return;
      context.report({
        node,
        message: `For Reanimated 4, replace \`${apiName}\` with \`${replacementName}\` from \`react-native-worklets\`.`,
      });
    },
  }),
});
