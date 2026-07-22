import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveReanimatedApiName } from "./utils/resolve-reanimated-api-name.js";

const REMOVED_API_MESSAGE_BY_NAME = new Map<string, string>([
  [
    "useAnimatedGestureHandler",
    "Reanimated 4 removed `useAnimatedGestureHandler`; migrate this gesture to the Gesture API.",
  ],
  [
    "useWorkletCallback",
    "Reanimated 4 removed `useWorkletCallback`; use React's `useCallback` with a `worklet` directive instead.",
  ],
  [
    "combineTransition",
    "Reanimated 4 removed `combineTransition`; compose the transition with `EntryExitTransition` instead.",
  ],
  [
    "addWhitelistedNativeProps",
    "Reanimated 4 removed `addWhitelistedNativeProps` because prop whitelisting is no longer needed.",
  ],
  [
    "addWhitelistedUIProps",
    "Reanimated 4 removed `addWhitelistedUIProps` because prop whitelisting is no longer needed.",
  ],
]);

const REMOVED_API_NAMES: ReadonlySet<string> = new Set(REMOVED_API_MESSAGE_BY_NAME.keys());

export const rnReanimated4NoRemovedApi = defineRule({
  id: "rn-reanimated-4-no-removed-api",
  title: "API removed in Reanimated 4",
  tags: ["migration-hint"],
  requires: ["reanimated:4"],
  severity: "warn",
  recommendation:
    "Migrate removed Reanimated APIs to their Reanimated 4 or Gesture API replacements before upgrading.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const apiName = resolveReanimatedApiName(node, context.scopes, REMOVED_API_NAMES);
      if (!apiName) return;
      const message = REMOVED_API_MESSAGE_BY_NAME.get(apiName);
      if (!message) return;
      context.report({ node, message });
    },
  }),
});
