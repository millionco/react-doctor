import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE_MISSING_HREF =
  "Keyboard users can't reach this link because it has no `href`, so add a real `href` (or use `<button>` for actions).";
const MESSAGE_INCORRECT_HREF =
  "Keyboard users can't reach this link because its `href` goes nowhere (`#`, `javascript:`, or empty), so point it at a real destination.";
const MESSAGE_CANT_BE_ANCHOR =
  "Keyboard users can't trigger this link because it's a click handler with no real `href`, so use `<button>` instead.";

interface AnchorIsValidSettings {
  validHrefs?: ReadonlyArray<string>;
}

interface JsxA11ySettings {
  attributes?: { href?: ReadonlyArray<string> };
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): { validHrefs: ReadonlySet<string>; hrefAttributeNames: ReadonlyArray<string> } => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { anchorIsValid?: AnchorIsValidSettings }).anchorIsValid ?? {})
      : {};
  const jsxA11y = settings?.["jsx-a11y"];
  const a11ySettings =
    typeof jsxA11y === "object" && jsxA11y !== null ? (jsxA11y as JsxA11ySettings) : {};
  return {
    validHrefs: new Set(ruleSettings.validHrefs ?? []),
    hrefAttributeNames: a11ySettings.attributes?.href ?? ["href"],
  };
};

const isInvalidHref = (value: string, validHrefs: ReadonlySet<string>): boolean => {
  if (validHrefs.has(value)) return false;
  return value === "" || value === "#" || value === "javascript:void(0)";
};

const checkValueIsEmptyOrInvalid = (
  value: EsTreeNode,
  validHrefs: ReadonlySet<string>,
): boolean => {
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "string" ? isInvalidHref(value.value, validHrefs) : false;
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") return true;
    if (isNodeOfType(expression, "Literal")) {
      if (expression.value === null) return true;
      if (typeof expression.value === "string") return isInvalidHref(expression.value, validHrefs);
    }
    if (isNodeOfType(expression, "TemplateLiteral")) {
      const staticValue = getStaticTemplateLiteralValue(expression);
      return staticValue === null ? false : isInvalidHref(staticValue, validHrefs);
    }
  }
  if (isNodeOfType(value, "JSXFragment")) return true;
  return false;
};

// Port of `oxc_linter::rules::jsx_a11y::anchor_is_valid`.
export const anchorIsValid = defineRule<Rule>({
  id: "anchor-is-valid",
  title: "Anchor used as a button",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Give links a real destination. Use `<button>` for in-page actions.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const tag = getElementType(node, context.settings);
        if (tag !== "a") return;
        // First-found custom href alternative, falling back to "href".
        let hrefAttribute: ReturnType<typeof hasJsxPropIgnoreCase> | undefined;
        for (const attributeName of settings.hrefAttributeNames) {
          hrefAttribute = hasJsxPropIgnoreCase(node.attributes, attributeName);
          if (hrefAttribute) break;
        }
        if (hrefAttribute) {
          if (!hrefAttribute.value) {
            context.report({ node: node.name, message: MESSAGE_INCORRECT_HREF });
            return;
          }
          if (checkValueIsEmptyOrInvalid(hrefAttribute.value as EsTreeNode, settings.validHrefs)) {
            const hasOnClick = Boolean(hasJsxPropIgnoreCase(node.attributes, "onClick"));
            context.report({
              node: node.name,
              message: hasOnClick ? MESSAGE_CANT_BE_ANCHOR : MESSAGE_INCORRECT_HREF,
            });
          }
          return;
        }
        // No href attribute. Skip if there's a spread (could provide href).
        const hasSpread = node.attributes.some((attribute) =>
          isNodeOfType(attribute as EsTreeNode, "JSXSpreadAttribute"),
        );
        if (hasSpread) return;
        context.report({ node: node.name, message: MESSAGE_MISSING_HREF });
      },
    };
  },
});
