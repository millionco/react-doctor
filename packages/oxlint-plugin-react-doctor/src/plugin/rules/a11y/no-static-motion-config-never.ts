import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isProvenMotionReactComponent } from "../../utils/is-proven-motion-react-component.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const ROOT_MOTION_CONFIG_FILE_PATTERN =
  /(?:^|\/)app\/layout\.[jt]sx$|(?:^|\/)pages\/_app\.[jt]sx$|(?:^|\/)(?:app|main|root)\.[jt]sx$/i;

export const noStaticMotionConfigNever = defineRule({
  id: "no-static-motion-config-never",
  title: "MotionConfig always ignores reduced motion",
  severity: "warn",
  category: "A11y",
  recommendation:
    'Use `reducedMotion="user"`, or derive the value from an explicit user preference instead of permanently disabling reduced-motion support.',
  create: (context: RuleContext): RuleVisitors => {
    if (!ROOT_MOTION_CONFIG_FILE_PATTERN.test(normalizeFilename(context.filename ?? ""))) return {};
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isProvenMotionReactComponent(node.name, "MotionConfig", context.scopes)) return;
        const reducedMotionAttribute = getAuthoritativeJsxAttribute(
          node.attributes,
          "reducedMotion",
        );
        if (
          !reducedMotionAttribute ||
          getStringLiteralAttributeValue(reducedMotionAttribute) !== "never"
        ) {
          return;
        }
        context.report({
          node: reducedMotionAttribute,
          message:
            'This MotionConfig hard-codes reducedMotion="never", so transform and layout motion ignores the user\'s operating-system preference.',
        });
      },
    };
  },
});
