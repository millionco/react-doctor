import { LONG_TRANSITION_DURATION_THRESHOLD_MS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A looping animation (a sibling `animationIterationCount` of `infinite`
// / `Infinity`) is a background loop, not a one-shot transition the user
// waits through — so the long-duration threshold doesn't apply.
const hasInfiniteIterationCount = (properties: ReadonlyArray<EsTreeNode>): boolean =>
  properties.some((property) => {
    if (getStylePropertyKey(property) !== "animationIterationCount") return false;
    if (getStylePropertyStringValue(property) === "infinite") return true;
    return (
      isNodeOfType(property, "Property") &&
      isNodeOfType(property.value, "Identifier") &&
      property.value.name === "Infinity"
    );
  });

// `infinite` must be a standalone token of the shorthand segment —
// hyphenated animation NAMES like `infinite-scroll` are still one-shot.
const isInfiniteAnimationSegment = (segment: string): boolean =>
  segment.trim().split(/\s+/).includes("infinite");

// `100ms` / `1.5s` as the WHOLE segment (transitionDuration / animationDuration
// values). One combined pattern replaces separate ms and s matches per segment.
const DURATION_SEGMENT_PATTERN = /^([\d.]+)(m?s)$/;

// First time token inside a `transition` / `animation` shorthand segment.
const FIRST_TIME_TOKEN_PATTERN = /(?<![a-zA-Z\d])([\d.]+)(m?s)(?![a-zA-Z\d-])/;

export const noLongTransitionDuration = defineRule({
  id: "no-long-transition-duration",
  title: "Transition duration too long",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Keep UI transitions under 1s. Use about 100 to 150ms for instant feedback, 200 to 300ms for state changes, and 300 to 500ms for layout. Save longer ones for big page-load animations.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      // An aria-hidden element is decorative — its slow drift is ambient
      // scenery, not a state change the user waits through.
      const openingElement = node.parent;
      if (
        openingElement &&
        isNodeOfType(openingElement, "JSXOpeningElement") &&
        isHiddenFromScreenReader(openingElement, context.settings)
      ) {
        return;
      }

      const properties = expression.properties ?? [];
      const isLoopingAnimation = hasInfiniteIterationCount(properties);

      for (const property of properties) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        const value = getStylePropertyStringValue(property);
        if (!value) continue;

        let durationMs: number | null = null;

        if (key === "transitionDuration" || key === "animationDuration") {
          let longestDurationPropertyMs = 0;
          for (const segment of value.split(",")) {
            const durationMatch = segment.trim().match(DURATION_SEGMENT_PATTERN);
            if (!durationMatch) continue;
            const segmentDurationMs =
              durationMatch[2] === "ms"
                ? parseFloat(durationMatch[1])
                : parseFloat(durationMatch[1]) * 1000;
            longestDurationPropertyMs = Math.max(longestDurationPropertyMs, segmentDurationMs);
          }
          if (longestDurationPropertyMs > 0) durationMs = longestDurationPropertyMs;
        }

        if (key === "transition" || key === "animation") {
          let longestDurationMs = 0;
          for (const segment of value.split(",")) {
            if (key === "animation" && isInfiniteAnimationSegment(segment)) continue;
            const firstTimeMatch = segment.match(FIRST_TIME_TOKEN_PATTERN);
            if (!firstTimeMatch) continue;
            const segmentDurationMs =
              firstTimeMatch[2] === "ms"
                ? parseFloat(firstTimeMatch[1])
                : parseFloat(firstTimeMatch[1]) * 1000;
            longestDurationMs = Math.max(longestDurationMs, segmentDurationMs);
          }
          if (longestDurationMs > 0) durationMs = longestDurationMs;
        }

        const isAnimationProperty = key === "animation" || key === "animationDuration";
        if (isAnimationProperty && isLoopingAnimation) continue;

        if (durationMs !== null && durationMs > LONG_TRANSITION_DURATION_THRESHOLD_MS) {
          context.report({
            node: property,
            message: `Your users wait through a sluggish ${durationMs}ms transition, so keep UI transitions under ${LONG_TRANSITION_DURATION_THRESHOLD_MS}ms & save longer ones for big page-load animations.`,
          });
        }
      }
    },
  }),
});
