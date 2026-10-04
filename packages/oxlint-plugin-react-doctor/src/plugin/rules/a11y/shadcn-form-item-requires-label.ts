import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getTrailingJsxNameSegment } from "../../utils/get-trailing-jsx-name-segment.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  SHADCN_UI_MODULE_SOURCE_PATTERN,
  resolveShadcnUiComponentName,
} from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { visitStaticJsxChildren } from "../../utils/visit-static-jsx-children.js";
import { walkAst } from "../../utils/walk-ast.js";

const FORM_MODULE_PATTERN = /(?:^|\/)ui\/(?:.*\/)?form$|^\.\.?\/(?:.*\/)?form$/;
const LABEL_ATTRIBUTES = ["aria-label", "aria-labelledby"] as const;

// react-hook-form's render prop hands the control its wiring as
// `{ field }` — `{...field}` spreads name/value/onChange/onBlur/ref and
// never an aria label, so the canonical shadcn form field stays checkable.
// Any other spread may deliver aria-label and makes the claim unprovable.
const RHF_FIELD_SPREAD_NAME_PATTERN = /^field(?:$|[A-Z])/;

const hasUnknownSpreadAttribute = (attributes: ReadonlyArray<EsTreeNode>): boolean =>
  attributes.some(
    (attribute) =>
      isNodeOfType(attribute, "JSXSpreadAttribute") &&
      !(
        isNodeOfType(attribute.argument, "Identifier") &&
        RHF_FIELD_SPREAD_NAME_PATTERN.test(attribute.argument.name)
      ),
  );

// shadcn's FormLabel wires htmlFor to the FormControl's generated id — a
// FormItem whose control has no FormLabel (and no aria naming) renders an
// unlabeled field. Intrinsic `label` and a name-alike local wrapper also
// satisfy the claim.
const isLabelElementName = (elementName: EsTreeNode, context: RuleContext): boolean => {
  if (resolveShadcnUiComponentName(elementName, FORM_MODULE_PATTERN, context) === "FormLabel") {
    return true;
  }
  const trailingSegment = getTrailingJsxNameSegment(elementName);
  return (
    trailingSegment === "label" || trailingSegment === "FormLabel" || trailingSegment === "Label"
  );
};

interface FormItemScan {
  hasControl: boolean;
  hasLabel: boolean;
  sawUnprovableContent: boolean;
}

const isInsideFormControl = (
  node: EsTreeNode,
  formItemElement: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  let ancestor = node.parent;
  while (ancestor && ancestor !== formItemElement) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      resolveShadcnUiComponentName(ancestor.openingElement.name, FORM_MODULE_PATTERN, context) ===
        "FormControl"
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const scanFormItem = (
  formItemElement: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): FormItemScan => {
  const scan: FormItemScan = { hasControl: false, hasLabel: false, sawUnprovableContent: false };
  visitStaticJsxChildren(formItemElement.children, {
    onElement: (element) => {
      const openingElement = element.openingElement;
      const elementName = openingElement.name;
      if (isLabelElementName(elementName, context)) {
        scan.hasLabel = true;
        return false;
      }
      const resolvedPartName = resolveShadcnUiComponentName(
        elementName,
        FORM_MODULE_PATTERN,
        context,
      );
      if (
        (resolvedPartName === "FormControl" ||
          isInsideFormControl(openingElement, formItemElement, context)) &&
        LABEL_ATTRIBUTES.some((attribute) =>
          hasJsxPropIgnoreCase(openingElement.attributes, attribute),
        )
      ) {
        // The control (or a wrapper) names itself directly.
        scan.hasLabel = true;
        return false;
      }
      if (hasUnknownSpreadAttribute(openingElement.attributes)) {
        // A spread can deliver aria-label to the control at runtime.
        scan.sawUnprovableContent = true;
      }
      if (resolvedPartName === "FormControl") {
        scan.hasControl = true;
        return true;
      }
      const trailingSegment = getTrailingJsxNameSegment(elementName);
      const isCustomComponent =
        trailingSegment !== null &&
        /^[A-Z]/.test(trailingSegment) &&
        trailingSegment !== "Fragment";
      if (
        isCustomComponent &&
        resolveShadcnUiComponentName(elementName, SHADCN_UI_MODULE_SOURCE_PATTERN, context) === null
      ) {
        // An unresolved custom component may render the label itself.
        scan.sawUnprovableContent = true;
      }
      return true;
    },
    onOpaqueExpression: (expression) => {
      scan.sawUnprovableContent = true;
      // Labels written inside map callbacks or other opaque expressions are
      // still statically visible.
      walkAst(expression, (node) => {
        if (isNodeOfType(node, "JSXOpeningElement") && isLabelElementName(node.name, context)) {
          scan.hasLabel = true;
        }
      });
    },
  });
  return scan;
};

export const shadcnFormItemRequiresLabel = defineRule({
  id: "shadcn-form-item-requires-label",
  title: "FormItem control without a label",
  severity: "warn",
  requires: ["shadcn"],
  recommendation:
    "Give every FormItem that wraps a FormControl a FormLabel (sr-only when the design shows no visible label) or name the control directly with aria-label.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveShadcnUiComponentName(node.name, FORM_MODULE_PATTERN, context) !== "FormItem") {
        return;
      }
      const formItemElement = node.parent;
      if (
        !formItemElement ||
        !isNodeOfType(formItemElement, "JSXElement") ||
        formItemElement.children.length === 0
      ) {
        return;
      }
      const scan = scanFormItem(formItemElement, context);
      if (!scan.hasControl || scan.hasLabel || scan.sawUnprovableContent) return;
      context.report({
        node: node.name,
        message:
          "This FormItem wraps a FormControl but renders no FormLabel, so the field has no accessible name. Add a FormLabel (visually hidden if the design shows no label) or an aria-label on the control.",
      });
    },
  }),
});
