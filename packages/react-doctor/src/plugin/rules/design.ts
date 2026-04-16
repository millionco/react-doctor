import {
  BOUNCE_ANIMATION_NAMES,
  INLINE_STYLE_PROPERTY_THRESHOLD,
  Z_INDEX_ABSURD_THRESHOLD,
} from "../constants.js";
import { walkAst } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

const isOvershootCubicBezier = (value: string): boolean => {
  const match = value.match(
    /cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/,
  );
  if (!match) return false;
  const y1 = parseFloat(match[2]);
  const y2 = parseFloat(match[4]);
  return y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1;
};

const hasBounceAnimationName = (value: string): boolean =>
  BOUNCE_ANIMATION_NAMES.some((name) => value.toLowerCase().includes(name));

export const noInlineBounceEasing: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;

      for (const property of expression.properties ?? []) {
        if (property.type !== "Property") continue;
        const key = property.key?.type === "Identifier" ? property.key.name : null;
        if (!key) continue;

        if (property.value?.type === "Literal" && typeof property.value.value === "string") {
          const value = property.value.value;

          if (
            (key === "transition" ||
              key === "transitionTimingFunction" ||
              key === "animation" ||
              key === "animationTimingFunction") &&
            isOvershootCubicBezier(value)
          ) {
            context.report({
              node: property,
              message:
                "Bounce/elastic easing feels dated — real objects decelerate smoothly. Use ease-out or cubic-bezier(0.16, 1, 0.3, 1) instead",
            });
          }

          if ((key === "animation" || key === "animationName") && hasBounceAnimationName(value)) {
            context.report({
              node: property,
              message:
                "Bounce/elastic animation name detected — these feel tacky. Use exponential easing (ease-out-quart/expo) for natural deceleration",
            });
          }
        }
      }
    },
  }),
};

export const noZIndex9999: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;

      for (const property of expression.properties ?? []) {
        if (property.type !== "Property") continue;
        const key = property.key?.type === "Identifier" ? property.key.name : null;
        if (key !== "zIndex") continue;

        let zValue: number | null = null;
        if (property.value?.type === "Literal" && typeof property.value.value === "number") {
          zValue = property.value.value;
        }
        if (
          property.value?.type === "UnaryExpression" &&
          property.value.operator === "-" &&
          property.value.argument?.type === "Literal" &&
          typeof property.value.argument.value === "number"
        ) {
          zValue = -property.value.argument.value;
        }

        if (zValue !== null && Math.abs(zValue) >= Z_INDEX_ABSURD_THRESHOLD) {
          context.report({
            node: property,
            message: `z-index: ${zValue} is arbitrarily high — use a deliberate z-index scale (1–50). Extreme values signal a stacking context problem, not a fix`,
          });
        }
      }
    },
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.property?.type !== "Identifier" || node.callee.property.name !== "create")
        return;
      if (node.callee.object?.type !== "Identifier" || node.callee.object.name !== "StyleSheet")
        return;

      const argument = node.arguments?.[0];
      if (!argument || argument.type !== "ObjectExpression") return;

      walkAst(argument, (child: EsTreeNode) => {
        if (child.type !== "Property") return;
        const key = child.key?.type === "Identifier" ? child.key.name : null;
        if (key !== "zIndex") return;

        if (child.value?.type === "Literal" && typeof child.value.value === "number") {
          const zValue = child.value.value;
          if (Math.abs(zValue) >= Z_INDEX_ABSURD_THRESHOLD) {
            context.report({
              node: child,
              message: `z-index: ${zValue} is arbitrarily high — use a deliberate z-index scale (1–50). Extreme values signal a stacking context problem, not a fix`,
            });
          }
        }
      });
    },
  }),
};

export const noInlineExhaustiveStyle: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ObjectExpression") return;

      const propertyCount =
        expression.properties?.filter((property: EsTreeNode) => property.type === "Property")
          .length ?? 0;

      if (propertyCount >= INLINE_STYLE_PROPERTY_THRESHOLD) {
        context.report({
          node: expression,
          message: `${propertyCount} inline style properties — extract to a CSS class, CSS module, or styled component for maintainability and reuse`,
        });
      }
    },
  }),
};
