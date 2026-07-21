import { ROOT_FONT_SIZE_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import { getTailwindVisibilityAtBreakpoints } from "../../utils/get-tailwind-visibility-at-breakpoints.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStaticEffectiveFontSize } from "./utils/get-static-effective-font-size.js";

const FORM_CONTROL_TAG_NAMES = new Set(["input", "select", "textarea"]);
const NON_TEXTUAL_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export const noSmallFormControlText = defineRule({
  id: "no-small-form-control-text",
  title: "Form control text is smaller than 16px",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Use at least 16px text on mobile inputs, selects, and textareas so content remains readable and mobile browsers do not zoom unexpectedly.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tagName = resolveJsxElementType(node);
      if (!FORM_CONTROL_TAG_NAMES.has(tagName)) return;
      const typeAttribute = getAuthoritativeJsxAttribute(node.attributes, "type");
      if (tagName === "input") {
        if (!typeAttribute) {
          if (findJsxAttribute(node.attributes, "type") || hasJsxSpreadAttribute(node.attributes)) {
            return;
          }
        } else {
          const inputType = getStringLiteralAttributeValue(typeAttribute)?.toLowerCase();
          if (inputType === undefined) {
            const value = typeAttribute.value;
            const isStaticallyOmitted =
              !value ||
              (isNodeOfType(value, "JSXExpressionContainer") &&
                (isNullishExpression(value.expression) ||
                  (isNodeOfType(value.expression, "Literal") && value.expression.value === false)));
            if (!isStaticallyOmitted) return;
          } else if (NON_TEXTUAL_INPUT_TYPES.has(inputType)) {
            return;
          }
        }
      }
      const classNameValue = getStringFromClassNameAttr(node);
      const hasTailwind = hasCapabilityOrUnspecified(context.settings, "tailwind");
      const visibilityAtBreakpoints =
        classNameValue && hasTailwind ? getTailwindVisibilityAtBreakpoints(classNameValue) : null;
      if (classNameValue && hasTailwind) {
        if (!visibilityAtBreakpoints) return;
        const [isVisibleByDefault, isVisibleAtSmallBreakpoint] = visibilityAtBreakpoints;
        if (!isVisibleByDefault && !isVisibleAtSmallBreakpoint) return;
      }
      const effectiveSize = getStaticEffectiveFontSize(node, hasTailwind);
      if (effectiveSize === null || effectiveSize <= 0 || effectiveSize >= ROOT_FONT_SIZE_PX) {
        return;
      }
      context.report({
        node,
        message: `This ${tagName} uses ${effectiveSize}px text on mobile. Use at least ${ROOT_FONT_SIZE_PX}px for readable controls and stable mobile focus.`,
      });
    },
  }),
});
