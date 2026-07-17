import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getImplicitRole } from "../../utils/get-implicit-role.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isFocusableJsxOpeningElement } from "../../utils/is-focusable-jsx-opening-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";

const PRESENTATIONAL_CHILD_ROLES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "img",
  "math",
  "menuitemcheckbox",
  "menuitemradio",
  "meter",
  "option",
  "progressbar",
  "radio",
  "scrollbar",
  "separator",
  "slider",
  "switch",
  "tab",
]);

const getRole = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): string | null => {
  const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role", false);
  const explicitRole = roleAttribute
    ? getStringLiteralAttributeValue(roleAttribute)?.trim().toLowerCase().split(/\s+/)[0]
    : null;
  if (roleAttribute) return explicitRole || null;
  return getImplicitRole(openingElement, resolveJsxElementType(openingElement), scopes);
};

const findEnclosingInteractiveControl = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  let ancestor: EsTreeNode | null | undefined = openingElement.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) {
      const isChildrenAttribute =
        isNodeOfType(ancestor.name, "JSXIdentifier") && ancestor.name.name === "children";
      if (!isChildrenAttribute) return null;
    }
    if (isNodeOfType(ancestor, "JSXElement")) {
      const ancestorOpeningElement = ancestor.openingElement;
      const ancestorType = resolveJsxElementType(ancestorOpeningElement);
      if (/^[A-Z]/.test(ancestorType)) {
        ancestor = ancestor.parent;
        continue;
      }
      if (ancestorType === "a" && resolveJsxElementType(openingElement) === "a") {
        return ancestorOpeningElement;
      }
      const ancestorRole = getRole(ancestorOpeningElement, scopes);
      if (ancestorRole && PRESENTATIONAL_CHILD_ROLES.has(ancestorRole)) {
        return ancestorOpeningElement;
      }
    }
    ancestor = ancestor.parent;
  }
  return null;
};

export const htmlNoNestedInteractive = defineRule({
  id: "html-no-nested-interactive",
  title: "Interactive control contains another focusable control",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Move the inner control beside its interactive ancestor so each action has independent semantics and focus behavior.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementType = resolveJsxElementType(node);
      if (
        /^[A-Z]/.test(elementType) ||
        !isFocusableJsxOpeningElement(node, elementType, true) ||
        !findEnclosingInteractiveControl(node, context.scopes)
      ) {
        return;
      }
      context.report({
        node: node.name,
        message: `This focusable \`<${elementType}>\` is nested inside an interactive ancestor whose descendants lose their own semantics. Move the inner control outside.`,
      });
    },
  }),
});
