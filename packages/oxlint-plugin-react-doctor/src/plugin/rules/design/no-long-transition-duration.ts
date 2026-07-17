import { LONG_TRANSITION_DURATION_THRESHOLD_MS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getConflictingMotionSpringDurationProperty } from "../../utils/get-conflicting-motion-spring-duration-property.js";
import { getStaticMotionTransitionObjects } from "../../utils/get-static-motion-transition-objects.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
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

// `animation: 'shrink 8s linear forwards'` — a fill-mode of `forwards`
// marks a one-shot animation that holds its end state (auto-dismiss
// countdowns, status fades, entrance heroes). Its duration IS the
// intended display time, the doc's deliberate-animation carve-out.
const isOneShotForwardsSegment = (segment: string): boolean =>
  segment.trim().split(/\s+/).includes("forwards");

const hasForwardsFillMode = (properties: ReadonlyArray<EsTreeNode>): boolean =>
  properties.some(
    (property) =>
      getStylePropertyKey(property) === "animationFillMode" &&
      getStylePropertyStringValue(property) === "forwards",
  );

// Tailwind's built-in animation utilities all loop forever; an inline
// `animationDuration` next to them merely tunes an ambient loop.
const INFINITE_ANIMATION_CLASS_PATTERN =
  /(?:^|\s)(?:motion-safe:|motion-reduce:|dark:|group-hover:|hover:)*animate-(?:ping|pulse|spin|bounce)(?:$|\s)/;

const getStaticClassNameText = (openingElement: EsTreeNode): string | null => {
  if (!isNodeOfType(openingElement, "JSXOpeningElement")) return null;
  for (const attribute of openingElement.attributes ?? []) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
    if (attribute.name.name !== "className" && attribute.name.name !== "class") continue;
    const value = attribute.value;
    if (isNodeOfType(value, "Literal") && typeof value.value === "string") return value.value;
    if (isNodeOfType(value, "JSXExpressionContainer")) {
      const expression = value.expression;
      if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
        return expression.value;
      }
      if (isNodeOfType(expression, "TemplateLiteral")) {
        return (expression.quasis ?? []).map((quasi) => quasi.value?.cooked ?? "").join(" ");
      }
    }
  }
  return null;
};

const hasInfiniteAnimationClassName = (openingElement: EsTreeNode | null | undefined): boolean => {
  if (!openingElement) return false;
  const classNameText = getStaticClassNameText(openingElement);
  return classNameText !== null && INFINITE_ANIMATION_CLASS_PATTERN.test(classNameText);
};

// `100ms` / `1.5s` as the WHOLE segment (transitionDuration / animationDuration
// values). One combined pattern replaces separate ms and s matches per segment.
const DURATION_SEGMENT_PATTERN = /^([\d.]+)(m?s)$/;

// First time token inside a `transition` / `animation` shorthand segment.
const FIRST_TIME_TOKEN_PATTERN = /(?<![a-zA-Z\d])([\d.]+)(m?s)(?![a-zA-Z\d-])/;

const isInfiniteMotionRepeat = (properties: ReadonlyArray<EsTreeNode>): boolean => {
  const repeatProperty = getEffectiveStyleProperty(properties, "repeat");
  if (!repeatProperty) return false;
  return (
    (isNodeOfType(repeatProperty.value, "Identifier") &&
      repeatProperty.value.name === "Infinity") ||
    (isNodeOfType(repeatProperty.value, "Literal") && repeatProperty.value.value === Infinity)
  );
};

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
      const isLoopingAnimation =
        hasInfiniteIterationCount(properties) || hasInfiniteAnimationClassName(openingElement);
      const isOneShotFillForwards = hasForwardsFillMode(properties);

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
            if (key === "animation" && isOneShotForwardsSegment(segment)) continue;
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
        if (isAnimationProperty && (isLoopingAnimation || isOneShotFillForwards)) continue;

        if (durationMs !== null && durationMs > LONG_TRANSITION_DURATION_THRESHOLD_MS) {
          context.report({
            node: property,
            message: `Your users wait through a sluggish ${durationMs}ms transition, so keep UI transitions under ${LONG_TRANSITION_DURATION_THRESHOLD_MS}ms & save longer ones for big page-load animations.`,
          });
        }
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (isHiddenFromScreenReader(node, context.settings)) return;
      for (const transitionObject of getStaticMotionTransitionObjects(node, context.scopes)) {
        if (isInfiniteMotionRepeat(transitionObject.properties)) continue;
        if (getConflictingMotionSpringDurationProperty(transitionObject.properties)) continue;
        const durationProperty = getEffectiveStyleProperty(transitionObject.properties, "duration");
        if (!durationProperty) continue;
        const durationSeconds = getStylePropertyNumberValue(durationProperty);
        if (
          durationSeconds === null ||
          durationSeconds * 1000 <= LONG_TRANSITION_DURATION_THRESHOLD_MS
        ) {
          continue;
        }
        context.report({
          node: durationProperty,
          message: `This Motion transition lasts ${durationSeconds}s, which makes routine UI feedback feel delayed. Keep ordinary interface motion under ${LONG_TRANSITION_DURATION_THRESHOLD_MS / 1000}s.`,
        });
      }
    },
  }),
});
