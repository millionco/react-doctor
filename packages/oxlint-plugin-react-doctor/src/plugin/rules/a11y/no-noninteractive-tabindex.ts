import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseJsxValue } from "../../utils/parse-jsx-value.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Keyboard users get stuck focusing this element they can't act on because `tabIndex` makes it tabbable, so remove it.";

interface NoNoninteractiveTabindexSettings {
  tags?: ReadonlyArray<string>;
  roles?: ReadonlyArray<string>;
  allowExpressionValues?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoNoninteractiveTabindexSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noNoninteractiveTabindex?: NoNoninteractiveTabindexSettings })
          .noNoninteractiveTabindex ?? {})
      : {};
  return {
    tags: ruleSettings.tags ?? [],
    roles: ruleSettings.roles ?? ["tabpanel"],
    allowExpressionValues: ruleSettings.allowExpressionValues ?? true,
  };
};

// Port of `oxc_linter::rules::jsx_a11y::no_noninteractive_tabindex`.
export const noNoninteractiveTabindex = defineRule<Rule>({
  id: "no-noninteractive-tabindex",
  title: "Tabindex on non-interactive element",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Only add `tabIndex` to interactive elements or interactive roles.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const tabIndex = hasJsxPropIgnoreCase(node.attributes, "tabIndex");
        if (!tabIndex) return;
        const tabIndexValue = tabIndex.value as EsTreeNode | null;
        if (!tabIndexValue) return;
        const numeric = parseJsxValue(tabIndexValue);
        if (numeric === null) {
          if (
            isNodeOfType(tabIndexValue, "JSXExpressionContainer") &&
            !settings.allowExpressionValues
          ) {
            context.report({ node: tabIndex, message: MESSAGE });
          }
          return;
        }
        if (numeric < 0 || numeric % 1 !== 0) return;

        const elementType = getElementType(node, context.settings);
        if (settings.tags.includes(elementType)) return;
        if (!HTML_TAGS.has(elementType)) return;
        if (isInteractiveElement(elementType, node)) return;

        const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
        if (!roleAttribute) {
          context.report({ node: tabIndex, message: MESSAGE });
          return;
        }
        const roleValue = roleAttribute.value as EsTreeNode | null;
        if (roleValue) {
          if (isNodeOfType(roleValue, "Literal") && typeof roleValue.value === "string") {
            const firstRole = roleValue.value.split(/\s+/)[0];
            if (firstRole && (isInteractiveRole(firstRole) || settings.roles.includes(firstRole))) {
              return;
            }
          }
          if (isNodeOfType(roleValue, "JSXExpressionContainer") && settings.allowExpressionValues) {
            return;
          }
        }
        context.report({ node: tabIndex, message: MESSAGE });
      },
    };
  },
});
