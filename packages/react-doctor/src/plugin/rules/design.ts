import {
  BOUNCE_ANIMATION_NAMES,
  DARK_GLOW_BLUR_THRESHOLD_PX,
  INLINE_STYLE_PROPERTY_THRESHOLD,
  LONG_TRANSITION_DURATION_THRESHOLD_MS,
  SIDE_TAB_BORDER_WIDTH_THRESHOLD_PX,
  TINY_TEXT_THRESHOLD_PX,
  WIDE_TRACKING_THRESHOLD_EM,
  Z_INDEX_ABSURD_THRESHOLD,
} from "../constants.js";
import { findJsxAttribute, walkAst } from "../helpers.js";
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

const getStringFromClassNameAttr = (node: EsTreeNode): string | null => {
  const classAttr = findJsxAttribute(node.attributes ?? [], "className");
  if (!classAttr?.value) return null;
  if (classAttr.value.type === "Literal" && typeof classAttr.value.value === "string") {
    return classAttr.value.value;
  }
  if (
    classAttr.value.type === "JSXExpressionContainer" &&
    classAttr.value.expression?.type === "Literal" &&
    typeof classAttr.value.expression.value === "string"
  ) {
    return classAttr.value.expression.value;
  }
  if (
    classAttr.value.type === "JSXExpressionContainer" &&
    classAttr.value.expression?.type === "TemplateLiteral" &&
    classAttr.value.expression.quasis?.length === 1
  ) {
    return classAttr.value.expression.quasis[0].value?.raw ?? null;
  }
  return null;
};

const getInlineStyleExpression = (node: EsTreeNode): EsTreeNode | null => {
  if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") return null;
  if (node.value?.type !== "JSXExpressionContainer") return null;
  const expression = node.value.expression;
  if (expression?.type !== "ObjectExpression") return null;
  return expression;
};

const getStylePropertyStringValue = (property: EsTreeNode): string | null => {
  if (property.value?.type === "Literal" && typeof property.value.value === "string") {
    return property.value.value;
  }
  return null;
};

const getStylePropertyNumberValue = (property: EsTreeNode): number | null => {
  if (property.value?.type === "Literal" && typeof property.value.value === "number") {
    return property.value.value;
  }
  if (
    property.value?.type === "UnaryExpression" &&
    property.value.operator === "-" &&
    property.value.argument?.type === "Literal" &&
    typeof property.value.argument.value === "number"
  ) {
    return -property.value.argument.value;
  }
  return null;
};

const getStylePropertyKey = (property: EsTreeNode): string | null => {
  if (property.type !== "Property") return null;
  if (property.key?.type === "Identifier") return property.key.name;
  if (property.key?.type === "Literal" && typeof property.key.value === "string")
    return property.key.value;
  return null;
};

const isNeutralBorderColor = (value: string): boolean => {
  const trimmed = value.trim().toLowerCase();
  if (["gray", "grey", "silver", "white", "black", "transparent", "currentcolor"].includes(trimmed))
    return true;
  const hexMatch = trimmed.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
  if (hexMatch) {
    const r = parseInt(hexMatch[1], 16);
    const g = parseInt(hexMatch[2], 16);
    const b = parseInt(hexMatch[3], 16);
    return Math.max(r, g, b) - Math.min(r, g, b) < 30;
  }
  return false;
};

const isPureBlackColor = (value: string): boolean => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "#000" || trimmed === "#000000") return true;
  if (/^rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(trimmed)) return true;
  return false;
};

const parseShadowColorChroma = (shadowValue: string): boolean => {
  const colorMatch = shadowValue.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!colorMatch) return false;
  const r = parseInt(colorMatch[1], 10);
  const g = parseInt(colorMatch[2], 10);
  const b = parseInt(colorMatch[3], 10);
  return Math.max(r, g, b) - Math.min(r, g, b) >= 30;
};

const parseShadowBlur = (shadowValue: string): number => {
  const pxValues = [...shadowValue.matchAll(/([\d.]+)px/g)].map((match) => parseFloat(match[1]));
  return pxValues.length >= 3 ? pxValues[2] : 0;
};

const isBackgroundDark = (bgValue: string): boolean => {
  const trimmed = bgValue.trim().toLowerCase();
  if (isPureBlackColor(trimmed)) return true;
  const hexMatch = trimmed.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
  if (hexMatch) {
    const r = parseInt(hexMatch[1], 16);
    const g = parseInt(hexMatch[2], 16);
    const b = parseInt(hexMatch[3], 16);
    return r <= 35 && g <= 35 && b <= 35;
  }
  const rgbMatch = trimmed.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return r <= 35 && g <= 35 && b <= 35;
  }
  return false;
};

const BORDER_SIDE_KEYS: Record<string, string> = {
  borderLeft: "left",
  borderRight: "right",
  borderInlineStart: "left",
  borderInlineEnd: "right",
};

const BORDER_SIDE_WIDTH_KEYS = new Set([
  "borderLeftWidth",
  "borderRightWidth",
  "borderInlineStartWidth",
  "borderInlineEndWidth",
]);

export const noInlineBounceEasing: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        const value = getStylePropertyStringValue(property);
        if (!value) continue;

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
    },
    JSXOpeningElement(node: EsTreeNode) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      if (/\banimate-bounce\b/.test(classStr)) {
        context.report({
          node,
          message:
            "animate-bounce feels dated and tacky — use a subtle ease-out transform for natural deceleration",
        });
      }
    },
  }),
};

export const noZIndex9999: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "zIndex") continue;

        const zValue = getStylePropertyNumberValue(property);
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
        const key = getStylePropertyKey(child);
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
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

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

export const noSideTabBorder: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let hasBorderRadius = false;
      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key === "borderRadius") {
          const numValue = getStylePropertyNumberValue(property);
          const strValue = getStylePropertyStringValue(property);
          if (
            (numValue !== null && numValue > 0) ||
            (strValue !== null && parseFloat(strValue) > 0)
          ) {
            hasBorderRadius = true;
          }
        }
      }

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        if (key in BORDER_SIDE_KEYS) {
          const value = getStylePropertyStringValue(property);
          if (!value) continue;
          const widthMatch = value.match(/^(\d+)px\s+solid/);
          if (!widthMatch) continue;
          const width = parseInt(widthMatch[1], 10);
          const threshold = hasBorderRadius ? 1 : SIDE_TAB_BORDER_WIDTH_THRESHOLD_PX;
          if (width >= threshold) {
            context.report({
              node: property,
              message: `Thick one-sided border (${BORDER_SIDE_KEYS[key]}: ${width}px) — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it`,
            });
          }
        }

        if (BORDER_SIDE_WIDTH_KEYS.has(key)) {
          const numValue = getStylePropertyNumberValue(property);
          const strValue = getStylePropertyStringValue(property);
          const width = numValue ?? (strValue !== null ? parseFloat(strValue) : NaN);
          if (isNaN(width)) continue;

          const colorKey = key.replace("Width", "Color");
          const hasColoredBorder = expression.properties?.some((colorProperty: EsTreeNode) => {
            const colorPropertyKey = getStylePropertyKey(colorProperty);
            if (colorPropertyKey !== colorKey) return false;
            const colorValue = getStylePropertyStringValue(colorProperty);
            return colorValue !== null && !isNeutralBorderColor(colorValue);
          });
          if (!hasColoredBorder) continue;

          const threshold = hasBorderRadius ? 1 : SIDE_TAB_BORDER_WIDTH_THRESHOLD_PX;
          if (width >= threshold) {
            context.report({
              node: property,
              message: `Thick one-sided border (${width}px) — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it`,
            });
          }
        }
      }
    },
    JSXOpeningElement(node: EsTreeNode) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      const sideMatch = classStr.match(/\bborder-[lrse]-(\d+)\b/);
      if (!sideMatch) return;

      const width = parseInt(sideMatch[1], 10);
      const hasRounded = /\brounded(?:-\w+)?\b/.test(classStr);
      const threshold = hasRounded ? 1 : 4;

      if (width >= threshold) {
        context.report({
          node,
          message: `Thick one-sided border (${sideMatch[0]}) — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it`,
        });
      }
    },
  }),
};

export const noPureBlackBackground: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "backgroundColor" && key !== "background") continue;

        const value = getStylePropertyStringValue(property);
        if (value && isPureBlackColor(value)) {
          context.report({
            node: property,
            message:
              "Pure #000 background looks harsh — tint slightly toward your brand hue for a more refined feel (e.g. #0a0a0f)",
          });
        }
      }
    },
    JSXOpeningElement(node: EsTreeNode) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      if (/\bbg-black\b(?!\/)/.test(classStr)) {
        context.report({
          node,
          message:
            "Pure black background (bg-black) looks harsh — use a near-black tinted toward your brand hue (e.g. bg-gray-950)",
        });
      }
    },
  }),
};

export const noGradientText: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let hasBackgroundClipText = false;
      let hasGradientBackground = false;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        const value = getStylePropertyStringValue(property);
        if (!key || !value) continue;

        if ((key === "backgroundClip" || key === "WebkitBackgroundClip") && value === "text") {
          hasBackgroundClipText = true;
        }
        if ((key === "backgroundImage" || key === "background") && value.includes("gradient")) {
          hasGradientBackground = true;
        }
      }

      if (hasBackgroundClipText && hasGradientBackground) {
        context.report({
          node: node.parent,
          message:
            "Gradient text (background-clip: text) is decorative rather than meaningful — a common AI tell. Use solid colors for text",
        });
      }
    },
    JSXOpeningElement(node: EsTreeNode) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      if (/\bbg-clip-text\b/.test(classStr) && /\bbg-gradient-to-/.test(classStr)) {
        context.report({
          node,
          message:
            "Gradient text (bg-clip-text + bg-gradient) is decorative rather than meaningful — a common AI tell. Use solid colors for text",
        });
      }
    },
  }),
};

export const noDarkModeGlow: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let hasDarkBg = false;
      let shadowProperty: EsTreeNode | null = null;
      let shadowValue: string | null = null;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        if (key === "backgroundColor" || key === "background") {
          const value = getStylePropertyStringValue(property);
          if (value && isBackgroundDark(value)) {
            hasDarkBg = true;
          }
        }

        if (key === "boxShadow") {
          shadowProperty = property;
          shadowValue = getStylePropertyStringValue(property);
        }
      }

      if (!hasDarkBg || !shadowValue || !shadowProperty) return;

      if (
        parseShadowColorChroma(shadowValue) &&
        parseShadowBlur(shadowValue) > DARK_GLOW_BLUR_THRESHOLD_PX
      ) {
        context.report({
          node: shadowProperty,
          message:
            "Colored glow on dark background — the default AI-generated 'cool' look. Use subtle, purposeful lighting instead",
        });
      }
    },
  }),
};

export const noJustifiedText: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let isJustified = false;
      let hasHyphens = false;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        const value = getStylePropertyStringValue(property);
        if (!key || !value) continue;

        if (key === "textAlign" && value === "justify") isJustified = true;
        if ((key === "hyphens" || key === "WebkitHyphens") && value === "auto") hasHyphens = true;
      }

      if (isJustified && !hasHyphens) {
        context.report({
          node: node.parent,
          message:
            'Justified text without hyphens creates uneven word spacing ("rivers of white"). Use text-align: left, or add hyphens: auto',
        });
      }
    },
  }),
};

export const noTinyText: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "fontSize") continue;

        let pxValue: number | null = null;
        const numValue = getStylePropertyNumberValue(property);
        const strValue = getStylePropertyStringValue(property);

        if (numValue !== null) {
          pxValue = numValue;
        } else if (strValue !== null) {
          const pxMatch = strValue.match(/^([\d.]+)px$/);
          if (pxMatch) pxValue = parseFloat(pxMatch[1]);
          const remMatch = strValue.match(/^([\d.]+)rem$/);
          if (remMatch) pxValue = parseFloat(remMatch[1]) * 16;
        }

        if (pxValue !== null && pxValue > 0 && pxValue < TINY_TEXT_THRESHOLD_PX) {
          context.report({
            node: property,
            message: `Font size ${pxValue}px is too small — body text should be at least 14px for readability, 16px is ideal`,
          });
        }
      }
    },
  }),
};

export const noWideLetterSpacing: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let isUppercase = false;
      let letterSpacingProperty: EsTreeNode | null = null;
      let letterSpacingEm: number | null = null;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        if (key === "textTransform") {
          const value = getStylePropertyStringValue(property);
          if (value === "uppercase") isUppercase = true;
        }

        if (key === "letterSpacing") {
          letterSpacingProperty = property;
          const strValue = getStylePropertyStringValue(property);
          const numValue = getStylePropertyNumberValue(property);
          if (strValue) {
            const emMatch = strValue.match(/^([\d.]+)em$/);
            if (emMatch) letterSpacingEm = parseFloat(emMatch[1]);
            const pxMatch = strValue.match(/^([\d.]+)px$/);
            if (pxMatch) letterSpacingEm = parseFloat(pxMatch[1]) / 16;
          }
          if (numValue !== null && numValue > 0) {
            letterSpacingEm = numValue / 16;
          }
        }
      }

      if (
        !isUppercase &&
        letterSpacingProperty &&
        letterSpacingEm !== null &&
        letterSpacingEm > WIDE_TRACKING_THRESHOLD_EM
      ) {
        context.report({
          node: letterSpacingProperty,
          message: `Letter spacing ${letterSpacingEm.toFixed(2)}em on body text disrupts natural character groupings. Reserve wide tracking for short uppercase labels only`,
        });
      }
    },
  }),
};

export const noGrayOnColoredBackground: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      const grayTextMatch = classStr.match(/\btext-(?:gray|slate|zinc|neutral|stone)-\d+\b/);
      const coloredBgMatch = classStr.match(
        /\bbg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+\b/,
      );

      if (grayTextMatch && coloredBgMatch) {
        context.report({
          node,
          message: `Gray text (${grayTextMatch[0]}) on colored background (${coloredBgMatch[0]}) looks washed out — use a darker shade of the background color or white`,
        });
      }
    },
  }),
};

export const noLayoutTransitionInline: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "transition" && key !== "transitionProperty") continue;

        const value = getStylePropertyStringValue(property);
        if (!value) continue;

        const lower = value.toLowerCase();
        if (/\ball\b/.test(lower)) continue;

        const layoutMatch = lower.match(
          /\b(?:(?:max|min)-)?(?:width|height)\b|\bpadding(?:-(?:top|right|bottom|left))?\b|\bmargin(?:-(?:top|right|bottom|left))?\b/,
        );
        if (layoutMatch) {
          context.report({
            node: property,
            message: `Transitioning layout property "${layoutMatch[0]}" causes layout thrash every frame — use transform and opacity instead`,
          });
        }
      }
    },
  }),
};

export const noDisabledZoom: Rule = {
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "meta") return;

      const nameAttr = findJsxAttribute(node.attributes ?? [], "name");
      if (!nameAttr?.value) return;
      const nameValue = nameAttr.value.type === "Literal" ? nameAttr.value.value : null;
      if (nameValue !== "viewport") return;

      const contentAttr = findJsxAttribute(node.attributes ?? [], "content");
      if (!contentAttr?.value) return;
      const contentValue =
        contentAttr.value.type === "Literal" && typeof contentAttr.value.value === "string"
          ? contentAttr.value.value
          : null;
      if (!contentValue) return;

      if (/user-scalable\s*=\s*no/i.test(contentValue)) {
        context.report({
          node,
          message:
            "user-scalable=no disables pinch-to-zoom — this is an accessibility violation (WCAG 1.4.4). Remove it and fix layout if it breaks at 200% zoom",
        });
      }

      const maxScaleMatch = contentValue.match(/maximum-scale\s*=\s*([\d.]+)/i);
      if (maxScaleMatch && parseFloat(maxScaleMatch[1]) < 2) {
        context.report({
          node,
          message: `maximum-scale=${maxScaleMatch[1]} restricts zoom below 200% — this is an accessibility violation (WCAG 1.4.4). Use maximum-scale=5 or remove it`,
        });
      }
    },
  }),
};

export const noOutlineNone: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let hasOutlineNone = false;
      let outlineProperty: EsTreeNode | null = null;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key !== "outline") continue;

        const strValue = getStylePropertyStringValue(property);
        const numValue = getStylePropertyNumberValue(property);

        if (strValue === "none" || strValue === "0" || numValue === 0) {
          hasOutlineNone = true;
          outlineProperty = property;
        }
      }

      if (!hasOutlineNone || !outlineProperty) return;

      const hasCustomFocusRing = expression.properties?.some((property: EsTreeNode) => {
        const key = getStylePropertyKey(property);
        return key === "boxShadow" || key === "outlineOffset" || key === "ring";
      });

      if (!hasCustomFocusRing) {
        context.report({
          node: outlineProperty,
          message:
            "outline: none removes keyboard focus visibility — use :focus-visible styling instead, or provide a box-shadow focus ring",
        });
      }
    },
  }),
};

export const noLongTransitionDuration: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        const value = getStylePropertyStringValue(property);
        if (!value) continue;

        let durationMs: number | null = null;

        if (key === "transitionDuration" || key === "animationDuration") {
          const msMatch = value.match(/^([\d.]+)ms$/);
          const sMatch = value.match(/^([\d.]+)s$/);
          if (msMatch) durationMs = parseFloat(msMatch[1]);
          else if (sMatch) durationMs = parseFloat(sMatch[1]) * 1000;
        }

        if (key === "transition") {
          const sMatch = value.match(/\b([\d.]+)s\b/);
          const msMatch = value.match(/\b(\d+)ms\b/);
          if (msMatch) durationMs = parseFloat(msMatch[1]);
          else if (sMatch) durationMs = parseFloat(sMatch[1]) * 1000;
        }

        if (durationMs !== null && durationMs > LONG_TRANSITION_DURATION_THRESHOLD_MS) {
          context.report({
            node: property,
            message: `${durationMs}ms transition is too slow for UI feedback — keep transitions under 500ms. Exit animations should be ~75% of enter duration`,
          });
        }
      }
    },
  }),
};
