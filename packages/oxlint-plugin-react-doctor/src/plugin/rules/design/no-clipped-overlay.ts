import { defineRule } from "../../utils/define-rule.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const OVERLAY_ROLES = new Set(["dialog", "listbox", "menu", "tooltip"]);
const CLIPPING_CLASS_NAMES = new Set(["overflow-clip", "overflow-hidden"]);
const ABSOLUTE_POSITION_CLASS_NAMES = new Set(["absolute"]);

const hasClassNameToken = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  targetTokens: ReadonlySet<string>,
): boolean => {
  const classNameValue = getStringFromClassNameAttr(node);
  return Boolean(
    classNameValue &&
    getUnvariantClassNameTokens(classNameValue).some((token) => targetTokens.has(token)),
  );
};

const isAbsoluteOverlay = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (!isNodeOfType(node.name, "JSXIdentifier") || /^[A-Z]/.test(node.name.name)) return false;
  const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
  const roleValue = roleAttribute
    ? getStringLiteralAttributeValue(roleAttribute)?.toLowerCase()
    : null;
  return Boolean(
    roleValue &&
    OVERLAY_ROLES.has(roleValue) &&
    hasClassNameToken(node, ABSOLUTE_POSITION_CLASS_NAMES),
  );
};

const hasClippingAncestor = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      hasClassNameToken(ancestor.openingElement, CLIPPING_CLASS_NAMES)
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const noClippedOverlay = defineRule({
  id: "no-clipped-overlay",
  title: "Overlay can be clipped by an overflow container",
  severity: "warn",
  tags: ["design", "test-noise"],
  category: "Correctness",
  recommendation:
    "Render the overlay outside the clipping container, usually through a portal, or remove the clipping overflow.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isAbsoluteOverlay(node.openingElement) || !hasClippingAncestor(node)) return;
      context.report({
        node: node.openingElement,
        message:
          "This positioned overlay sits inside an overflow-clipping ancestor, so menus or tooltips can be cut off. Portal it outside the container.",
      });
    },
  }),
});
