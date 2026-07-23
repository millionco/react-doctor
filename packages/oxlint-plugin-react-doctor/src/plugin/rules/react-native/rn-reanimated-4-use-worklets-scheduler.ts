import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveReanimatedApiName } from "./utils/resolve-reanimated-api-name.js";

const WORKLETS_MIGRATION_BY_REANIMATED_API = new Map<string, string>([
  ["runOnUI", "replace `runOnUI(fn)(...args)` with `scheduleOnUI(fn, ...args)`"],
  ["runOnJS", "replace `runOnJS(fn)(...args)` with `scheduleOnRN(fn, ...args)`"],
  [
    "executeOnUIRuntimeSync",
    "replace `executeOnUIRuntimeSync(fn)(...args)` with `runOnUISync(fn, ...args)`",
  ],
  [
    "runOnRuntime",
    "replace `runOnRuntime(runtime, fn)(...args)` with `scheduleOnRuntime(runtime, fn, ...args)`",
  ],
]);

const REANIMATED_SCHEDULER_API_NAMES: ReadonlySet<string> = new Set(
  WORKLETS_MIGRATION_BY_REANIMATED_API.keys(),
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
      const migration = WORKLETS_MIGRATION_BY_REANIMATED_API.get(apiName);
      if (!migration) return;
      context.report({
        node,
        message: `For Reanimated 4, ${migration} from \`react-native-worklets\`.`,
      });
    },
  }),
});
