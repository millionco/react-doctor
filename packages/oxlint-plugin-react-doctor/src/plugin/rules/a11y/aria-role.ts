import { VALID_ARIA_ROLES } from "../../constants/aria-roles.js";
import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const buildBaseMessage = (suffix: string): string =>
  `Screen reader users get no help from this \`role\` because it isn't a valid ARIA role, so use a real, non-abstract role.${suffix}`;

interface AriaRoleSettings {
  allowedInvalidRoles?: ReadonlyArray<string>;
  ignoreNonDOM?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<AriaRoleSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { ariaRole?: AriaRoleSettings }).ariaRole ?? {})
      : {};
  return {
    allowedInvalidRoles: ruleSettings.allowedInvalidRoles ?? [],
    ignoreNonDOM: ruleSettings.ignoreNonDOM ?? false,
  };
};

// Port of `oxc_linter::rules::jsx_a11y::aria_role`.
export const ariaRole = defineRule<Rule>({
  id: "aria-role",
  title: "Invalid ARIA role",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation: "Use a real, non-abstract ARIA role.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
        if (!roleAttribute) return;
        const elementType = getElementType(node, context.settings);
        if (settings.ignoreNonDOM && !HTML_TAGS.has(elementType)) return;
        const value = roleAttribute.value as EsTreeNode | null;
        if (!value) {
          context.report({ node: roleAttribute, message: buildBaseMessage("") });
          return;
        }
        if (isNodeOfType(value, "Literal")) {
          if (typeof value.value !== "string") {
            context.report({ node: roleAttribute, message: buildBaseMessage("") });
            return;
          }
          const stringValue = value.value;
          if (stringValue.trim().length === 0) {
            context.report({ node: roleAttribute, message: buildBaseMessage("") });
            return;
          }
          const tokens = stringValue.split(/\s+/).filter((token) => token.length > 0);
          for (const token of tokens) {
            if (!VALID_ARIA_ROLES.has(token) && !settings.allowedInvalidRoles.includes(token)) {
              context.report({
                node: roleAttribute,
                message: buildBaseMessage(` \`${token}\` is not one.`),
              });
              return;
            }
          }
          return;
        }
        if (isNodeOfType(value, "JSXExpressionContainer")) {
          const expression = value.expression;
          if (isNodeOfType(expression as EsTreeNode, "Literal")) {
            const literalValue = (expression as EsTreeNodeOfType<"Literal">).value;
            if (literalValue === null) {
              context.report({ node: roleAttribute, message: buildBaseMessage("") });
              return;
            }
          }
          if (
            isNodeOfType(expression as EsTreeNode, "Identifier") &&
            (expression as EsTreeNodeOfType<"Identifier">).name === "undefined"
          ) {
            context.report({ node: roleAttribute, message: buildBaseMessage("") });
            return;
          }
          // Dynamic expression — assumed valid.
          return;
        }
        context.report({ node: roleAttribute, message: buildBaseMessage("") });
      },
    };
  },
});
