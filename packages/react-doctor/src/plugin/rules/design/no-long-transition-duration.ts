import { LONG_TRANSITION_DURATION_THRESHOLD_MS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noLongTransitionDuration = defineRule<Rule>({
  id: "no-long-transition-duration",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Keep UI transitions under 1s — 100-150ms for instant feedback, 200-300ms for state changes, 300-500ms for layout changes. Use longer durations only for page-load hero animations",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        const value = getStylePropertyStringValue(property);
        if (!value) continue;

        let durationMs: number | null = null;

        if (key === "transitionDuration" || key === "animationDuration") {
          let longestDurationPropertyMs = 0;
          for (const segment of value.split(",")) {
            const trimmedSegment = segment.trim();
            const msMatch = trimmedSegment.match(/^([\d.]+)ms$/);
            const secondsMatch = trimmedSegment.match(/^([\d.]+)s$/);
            if (msMatch)
              longestDurationPropertyMs = Math.max(
                longestDurationPropertyMs,
                parseFloat(msMatch[1]),
              );
            else if (secondsMatch)
              longestDurationPropertyMs = Math.max(
                longestDurationPropertyMs,
                parseFloat(secondsMatch[1]) * 1000,
              );
          }
          if (longestDurationPropertyMs > 0) durationMs = longestDurationPropertyMs;
        }

        if (key === "transition" || key === "animation") {
          let longestDurationMs = 0;
          const segments = value.split(",");
          for (const segment of segments) {
            const firstTimeMatch = segment.match(/(?<![a-zA-Z\d])([\d.]+)(m?s)(?![a-zA-Z\d-])/);
            if (!firstTimeMatch) continue;
            const segmentDurationMs =
              firstTimeMatch[2] === "ms"
                ? parseFloat(firstTimeMatch[1])
                : parseFloat(firstTimeMatch[1]) * 1000;
            longestDurationMs = Math.max(longestDurationMs, segmentDurationMs);
          }
          if (longestDurationMs > 0) durationMs = longestDurationMs;
        }

        if (durationMs !== null && durationMs > LONG_TRANSITION_DURATION_THRESHOLD_MS) {
          context.report({
            node: property,
            message: `${durationMs}ms transition is too slow for UI feedback — keep transitions under ${LONG_TRANSITION_DURATION_THRESHOLD_MS}ms. Use longer durations only for page-load hero animations`,
          });
        }
      }
    },
  }),
});
