import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { resolveReanimatedApiName } from "./utils/resolve-reanimated-api-name.js";

const WITH_SPRING_API_NAMES: ReadonlySet<string> = new Set(["withSpring"]);
const LEGACY_SPRING_THRESHOLD_NAMES: ReadonlySet<string> = new Set([
  "restDisplacementThreshold",
  "restSpeedThreshold",
]);

export const rnReanimated4NoLegacySpringThresholds = defineRule({
  id: "rn-reanimated-4-no-legacy-spring-thresholds",
  title: "Legacy Reanimated spring threshold",
  tags: ["migration-hint"],
  requires: ["reanimated:4"],
  severity: "warn",
  recommendation:
    "Replace Reanimated 3 rest thresholds with Reanimated 4's `energyThreshold` spring option.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!resolveReanimatedApiName(node, context.scopes, WITH_SPRING_API_NAMES)) return;
      const configArgument = node.arguments[1];
      if (!configArgument || isNodeOfType(configArgument, "SpreadElement")) return;
      const unwrappedConfig = stripParenExpression(configArgument);
      if (!isNodeOfType(unwrappedConfig, "ObjectExpression")) return;

      for (const property of unwrappedConfig.properties) {
        if (!isNodeOfType(property, "Property")) continue;
        const propertyName = getStaticPropertyKeyName(property, {
          allowComputedString: true,
        });
        if (!propertyName || !LEGACY_SPRING_THRESHOLD_NAMES.has(propertyName)) continue;
        context.report({
          node: property,
          message: `Reanimated 4 removed \`${propertyName}\`; use the \`energyThreshold\` spring option instead.`,
        });
      }
    },
  }),
});
