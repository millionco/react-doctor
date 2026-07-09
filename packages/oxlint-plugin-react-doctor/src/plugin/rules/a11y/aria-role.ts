import { VALID_ARIA_ROLES } from "../../constants/aria-roles.js";
import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const buildBaseMessage = (suffix: string): string =>
  `This \`role\` is not a valid ARIA role, so assistive tech cannot expose it correctly. Use a real, non-abstract role.${suffix}`;

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
  // Default to `true`: a `role` prop on a CUSTOM component is very
  // often a domain prop (chat message role, workspace member role,
  // hook option), not the DOM ARIA attribute — and `role={undefined}`
  // on MUI wrappers is the documented pattern for clearing a default
  // role. When the component does forward `role` to a DOM element,
  // the rule still fires at that element inside the component. In the
  // verify corpus every custom-component hit was a false positive.
  return {
    allowedInvalidRoles: ruleSettings.allowedInvalidRoles ?? [],
    ignoreNonDOM: ruleSettings.ignoreNonDOM ?? true,
  };
};

// Port of `oxc_linter::rules::jsx_a11y::aria_role`.
export const ariaRole = defineRule({
  id: "aria-role",
  title: "Invalid ARIA role",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Use a real, non-abstract ARIA role so assistive tech can expose the element correctly.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
        if (!roleAttribute) return;
        const elementType = getElementType(node, context.settings);
        if (settings.ignoreNonDOM && !HTML_TAGS.has(elementType)) return;

        // Reports the first invalid candidate and stops: for a ternary,
        // each branch is independently a bug when taken, so ANY invalid
        // candidate is worth reporting.
        const reportFirstInvalidCandidate = (candidates: ReadonlyArray<string>): void => {
          for (const candidate of candidates) {
            if (candidate.trim().length === 0) {
              context.report({ node: roleAttribute, message: buildBaseMessage("") });
              return;
            }
            const tokens = candidate.split(/\s+/).filter((token) => token.length > 0);
            for (const token of tokens) {
              if (!VALID_ARIA_ROLES.has(token) && !settings.allowedInvalidRoles.includes(token)) {
                context.report({
                  node: roleAttribute,
                  message: buildBaseMessage(` \`${token}\` is not one.`),
                });
                return;
              }
            }
          }
        };

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
          reportFirstInvalidCandidate([value.value]);
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
          const resolvedCandidates = getJsxPropStaticStringValues(roleAttribute, context.scopes);
          if (resolvedCandidates !== null) {
            reportFirstInvalidCandidate(resolvedCandidates);
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
