import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNextjsMetadataImageRouteFilename } from "../../utils/is-nextjs-metadata-image-route-filename.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { objectHasAccessibleChild } from "../../utils/object-has-accessible-child.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const MISSING_ALT_PROP =
  'Blind users can\'t use this image because screen readers skip it without `alt`, so add `alt="..."` (or `alt=""` if decorative).';
const MISSING_ALT_VALUE =
  'Blind users can\'t use this image because its `alt` is empty or invalid, so add a short description (or `alt=""` if decorative).';
const ARIA_LABEL_VALUE =
  "Blind users hear nothing here because `aria-label` has no value, so give it a short description.";
const ARIA_LABELLEDBY_VALUE =
  "Blind users hear nothing here because `aria-labelledby` has no value, so point it at the id of the text that labels this.";
const PREFER_ALT =
  'Screen readers skip a decorative image more reliably with `alt=""` than `role="presentation"`, so use `alt=""` instead.';
const MESSAGE_OBJECT =
  "Blind users can't use this `<object>` because screen readers can't describe it, so add `alt`, `aria-label`, `aria-labelledby`, `title`, or inner fallback text.";
const MESSAGE_AREA =
  "Blind users can't use this `<area>` of the image map because screen readers can't describe it, so add `alt`, `aria-label`, or `aria-labelledby`.";
const MESSAGE_INPUT_IMAGE =
  "Blind users can't use this image button because screen readers can't describe it, so add `alt`, `aria-label`, or `aria-labelledby`.";

interface AltTextSettings {
  elements?: ReadonlyArray<string>;
  img?: ReadonlyArray<string>;
  area?: ReadonlyArray<string>;
  'input[type="image"]'?: ReadonlyArray<string>;
  object?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): AltTextSettings => {
  const reactDoctor = settings?.["react-doctor"];
  return typeof reactDoctor === "object" && reactDoctor !== null
    ? ((reactDoctor as { altText?: AltTextSettings }).altText ?? {})
    : {};
};

const isUndefinedOrNullExpression = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") return true;
  if (isNodeOfType(expression, "Literal") && expression.value === null) return true;
  return false;
};

// Mirrors `is_valid_alt_prop` — alt is valid when present and not
// {undefined} / {null}.
const isValidAltProp = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value) return false;
  if (isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    const expression = attribute.value.expression;
    if (expression && expression.type !== "JSXEmptyExpression") {
      return !isUndefinedOrNullExpression(expression as EsTreeNode);
    }
    return true;
  }
  return true;
};

const isPresentationRole = (attribute: EsTreeNodeOfType<"JSXAttribute"> | undefined): boolean => {
  if (!attribute) return false;
  const value = getJsxPropStringValue(attribute);
  return value === "presentation" || value === "none";
};

// Mirrors `aria_label_has_value` — string literal must be non-empty,
// expression container must not be `undefined`.
const ariaLabelHasValue = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value) return false;
  if (isNodeOfType(attribute.value, "Literal")) {
    if (typeof attribute.value.value === "string") return attribute.value.value.length > 0;
    return true;
  }
  if (isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    const expression = attribute.value.expression;
    if (!expression || expression.type === "JSXEmptyExpression") return true;
    if (
      isNodeOfType(expression as EsTreeNode, "Identifier") &&
      (expression as { name: string }).name === "undefined"
    ) {
      return false;
    }
    return true;
  }
  return true;
};

const imgRule = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  reportNode: EsTreeNode,
  context: Parameters<Rule["create"]>[0],
): void => {
  const altAttribute = hasJsxPropIgnoreCase(opening.attributes, "alt");
  if (altAttribute) {
    if (!isValidAltProp(altAttribute)) {
      context.report({ node: reportNode, message: MISSING_ALT_VALUE });
    }
    return;
  }
  const roleAttribute = hasJsxPropIgnoreCase(opening.attributes, "role");
  if (isPresentationRole(roleAttribute)) {
    context.report({ node: reportNode, message: PREFER_ALT });
    return;
  }
  const ariaLabelAttribute = hasJsxPropIgnoreCase(opening.attributes, "aria-label");
  if (ariaLabelAttribute) {
    if (!ariaLabelHasValue(ariaLabelAttribute)) {
      context.report({ node: reportNode, message: ARIA_LABEL_VALUE });
    }
    return;
  }
  const ariaLabelledbyAttribute = hasJsxPropIgnoreCase(opening.attributes, "aria-labelledby");
  if (ariaLabelledbyAttribute) {
    if (!ariaLabelHasValue(ariaLabelledbyAttribute)) {
      context.report({ node: reportNode, message: ARIA_LABELLEDBY_VALUE });
    }
    return;
  }
  context.report({ node: reportNode, message: MISSING_ALT_PROP });
};

const objectRule = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  parent: EsTreeNodeOfType<"JSXElement">,
  reportNode: EsTreeNode,
  context: Parameters<Rule["create"]>[0],
): void => {
  const ariaLabelAttribute = hasJsxPropIgnoreCase(opening.attributes, "aria-label");
  const ariaLabelledbyAttribute = hasJsxPropIgnoreCase(opening.attributes, "aria-labelledby");
  const hasLabel =
    (ariaLabelAttribute && ariaLabelHasValue(ariaLabelAttribute)) ||
    (ariaLabelledbyAttribute && ariaLabelHasValue(ariaLabelledbyAttribute));
  const titleAttribute = hasJsxPropIgnoreCase(opening.attributes, "title");
  const titleValue = titleAttribute ? getJsxPropStringValue(titleAttribute) : null;
  const hasTitle = Boolean(titleValue && titleValue.length > 0);
  if (hasLabel || hasTitle) return;
  if (objectHasAccessibleChild(parent, context.settings)) return;
  context.report({ node: reportNode, message: MESSAGE_OBJECT });
};

const areaRule = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  reportNode: EsTreeNode,
  context: Parameters<Rule["create"]>[0],
): void => {
  const ariaLabelAttribute = hasJsxPropIgnoreCase(opening.attributes, "aria-label");
  const ariaLabelledbyAttribute = hasJsxPropIgnoreCase(opening.attributes, "aria-labelledby");
  const hasLabel =
    (ariaLabelAttribute && ariaLabelHasValue(ariaLabelAttribute)) ||
    (ariaLabelledbyAttribute && ariaLabelHasValue(ariaLabelledbyAttribute));
  if (hasLabel) return;
  const altAttribute = hasJsxPropIgnoreCase(opening.attributes, "alt");
  if (!altAttribute || !isValidAltProp(altAttribute)) {
    context.report({ node: reportNode, message: MESSAGE_AREA });
  }
};

const inputTypeImageRule = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  reportNode: EsTreeNode,
  context: Parameters<Rule["create"]>[0],
): void => {
  const ariaLabelAttribute = hasJsxPropIgnoreCase(opening.attributes, "aria-label");
  const ariaLabelledbyAttribute = hasJsxPropIgnoreCase(opening.attributes, "aria-labelledby");
  const hasLabel =
    (ariaLabelAttribute && ariaLabelHasValue(ariaLabelAttribute)) ||
    (ariaLabelledbyAttribute && ariaLabelHasValue(ariaLabelledbyAttribute));
  if (hasLabel) return;
  const altAttribute = hasJsxPropIgnoreCase(opening.attributes, "alt");
  if (!altAttribute || !isValidAltProp(altAttribute)) {
    context.report({ node: reportNode, message: MESSAGE_INPUT_IMAGE });
  }
};

// Port of `oxc_linter::rules::jsx_a11y::alt_text`.
export const altText = defineRule<Rule>({
  id: "alt-text",
  title: "Image missing alt text",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation: "Give every meaningful image an `alt`, `aria-label`, or `aria-labelledby`.",
  category: "Accessibility",
  create: (context): RuleVisitors => {
    if (isNextjsMetadataImageRouteFilename(context.filename)) return {};
    const settings = resolveSettings(context.settings);
    // Settings.elements selects WHICH element classes to check.
    // Default: all four. Custom aliases are merged into each class.
    const checkImg = !settings.elements || settings.elements.includes("img");
    const checkObject = !settings.elements || settings.elements.includes("object");
    const checkArea = !settings.elements || settings.elements.includes("area");
    const checkInputImage = !settings.elements || settings.elements.includes('input[type="image"]');
    const imgAliases = new Set(settings.img ?? []);
    const objectAliases = new Set(settings.object ?? []);
    const areaAliases = new Set(settings.area ?? []);
    const inputImageAliases = new Set(settings['input[type="image"]'] ?? []);

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const tag = getElementType(node, context.settings);

        if (checkImg && (tag === "img" || imgAliases.has(tag))) {
          imgRule(node, node, context);
          return;
        }
        if (checkObject && (tag === "object" || objectAliases.has(tag))) {
          const parent = (node as EsTreeNode).parent;
          if (parent && isNodeOfType(parent, "JSXElement")) {
            objectRule(node, parent, node, context);
          }
          return;
        }
        if (checkArea && (tag === "area" || areaAliases.has(tag))) {
          areaRule(node, node, context);
          return;
        }
        if (checkInputImage) {
          const isInputImage =
            tag.toLowerCase() === "input" &&
            (() => {
              const typeAttribute = hasJsxPropIgnoreCase(node.attributes, "type");
              if (!typeAttribute) return false;
              return getJsxPropStringValue(typeAttribute) === "image";
            })();
          if (isInputImage || inputImageAliases.has(tag)) {
            inputTypeImageRule(node, node, context);
          }
        }
      },
    };
  },
});
