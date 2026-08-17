import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getTrailingJsxNameSegment } from "../../utils/get-trailing-jsx-name-segment.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveNamespacedPartName } from "../../utils/resolve-namespaced-part-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { visitStaticJsxChildren } from "../../utils/visit-static-jsx-children.js";
import { walkAst } from "../../utils/walk-ast.js";

const BASE_UI_FIELD_MODULE_PATTERN = /^@base-ui(?:-components)?\/react(?:\/field)?$/;
const LABEL_ATTRIBUTES = ["aria-label", "aria-labelledby"] as const;

const resolveFieldPartName = (elementName: EsTreeNode, context: RuleContext): string | null =>
  resolveNamespacedPartName(elementName, BASE_UI_FIELD_MODULE_PATTERN, "Field", context);

// Base UI's Field.Label associates itself with the field's control
// automatically — a Field.Root whose control has no Field.Label (and no aria
// naming) renders an unlabeled field. Intrinsic `label` and name-alike local
// wrappers also satisfy the claim.
const isLabelElementName = (elementName: EsTreeNode, context: RuleContext): boolean => {
  if (resolveFieldPartName(elementName, context) === "Label") return true;
  const trailingSegment = getTrailingJsxNameSegment(elementName);
  return (
    trailingSegment === "label" || trailingSegment === "Label" || trailingSegment === "FieldLabel"
  );
};

interface FieldScan {
  hasControl: boolean;
  hasLabel: boolean;
  sawUnprovableContent: boolean;
}

const isInsideFieldControl = (
  node: EsTreeNode,
  fieldRootElement: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  let ancestor = node.parent;
  while (ancestor && ancestor !== fieldRootElement) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      resolveFieldPartName(ancestor.openingElement.name, context) === "Control"
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const scanFieldRoot = (
  fieldRootElement: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): FieldScan => {
  const scan: FieldScan = { hasControl: false, hasLabel: false, sawUnprovableContent: false };
  visitStaticJsxChildren(fieldRootElement.children, {
    onElement: (element) => {
      const openingElement = element.openingElement;
      const elementName = openingElement.name;
      if (isLabelElementName(elementName, context)) {
        scan.hasLabel = true;
        return false;
      }
      const resolvedPart = resolveFieldPartName(elementName, context);
      if (
        (resolvedPart === "Control" ||
          isInsideFieldControl(openingElement, fieldRootElement, context)) &&
        LABEL_ATTRIBUTES.some((attribute) =>
          hasJsxPropIgnoreCase(openingElement.attributes, attribute),
        )
      ) {
        // The control (or a wrapper) names itself directly.
        scan.hasLabel = true;
        return false;
      }
      if (hasJsxSpreadAttribute(openingElement.attributes)) {
        // A spread can deliver aria-label to the control at runtime.
        scan.sawUnprovableContent = true;
      }
      // Base UI swaps the rendered element through the `render` prop
      // (`<Field.Control render={<Textarea aria-label="Notes" />} />`), so
      // aria naming written there counts.
      const renderAttribute = findJsxAttribute(openingElement.attributes, "render");
      if (renderAttribute?.value) {
        walkAst(renderAttribute.value, (renderNode) => {
          if (
            isNodeOfType(renderNode, "JSXOpeningElement") &&
            LABEL_ATTRIBUTES.some((attribute) =>
              hasJsxPropIgnoreCase(renderNode.attributes, attribute),
            )
          ) {
            scan.hasLabel = true;
          }
        });
      }
      if (resolvedPart === "Control") {
        scan.hasControl = true;
        return true;
      }
      if (resolvedPart !== null) return true;
      const trailingSegment = getTrailingJsxNameSegment(elementName);
      if (
        trailingSegment !== null &&
        /^[A-Z]/.test(trailingSegment) &&
        trailingSegment !== "Fragment"
      ) {
        // An unresolved custom component may render the label itself.
        scan.sawUnprovableContent = true;
      }
      return true;
    },
    onOpaqueExpression: (expression) => {
      scan.sawUnprovableContent = true;
      walkAst(expression, (node) => {
        if (isNodeOfType(node, "JSXOpeningElement") && isLabelElementName(node.name, context)) {
          scan.hasLabel = true;
        }
      });
    },
  });
  return scan;
};

export const baseUiFieldRequiresLabel = defineRule({
  id: "base-ui-field-requires-label",
  title: "Base UI field control without a label",
  severity: "warn",
  requires: ["base-ui"],
  recommendation:
    "Give every Field.Root that wraps a Field.Control a Field.Label (visually hidden when the design shows no label) or name the control directly with aria-label.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveFieldPartName(node.name, context) !== "Root") return;
      const fieldRootElement = node.parent;
      if (
        !fieldRootElement ||
        !isNodeOfType(fieldRootElement, "JSXElement") ||
        fieldRootElement.children.length === 0
      ) {
        return;
      }
      const scan = scanFieldRoot(fieldRootElement, context);
      if (!scan.hasControl || scan.hasLabel || scan.sawUnprovableContent) return;
      context.report({
        node: node.name,
        message:
          "This Field.Root wraps a Field.Control but renders no Field.Label, so the field has no accessible name. Add a Field.Label (visually hidden if the design shows no label) or an aria-label on the control.",
      });
    },
  }),
});
