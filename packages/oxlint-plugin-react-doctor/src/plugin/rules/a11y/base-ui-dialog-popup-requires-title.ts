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
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { scanJsxSubtreeForPart } from "../../utils/scan-jsx-subtree-for-part.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

interface BaseUiDialogSurface {
  readonly namespaceName: string;
  // The component subpath and the package root both export the namespace;
  // both package names (pre-1.0 and the 1.0 rename) resolve it.
  readonly moduleSourcePattern: RegExp;
}

// Base UI's Dialog.Popup is the `role="dialog"` element; it takes its
// accessible name from a Dialog.Title (wired automatically) or an explicit
// aria-label. Without either, assistive technology announces an unnamed
// dialog.
const BASE_UI_DIALOG_SURFACES: ReadonlyArray<BaseUiDialogSurface> = [
  {
    namespaceName: "Dialog",
    moduleSourcePattern: /^@base-ui(?:-components)?\/react(?:\/dialog)?$/,
  },
  {
    namespaceName: "AlertDialog",
    moduleSourcePattern: /^@base-ui(?:-components)?\/react(?:\/alert-dialog)?$/,
  },
];

const NAME_PROVIDING_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"] as const;

const renderPropMayProvideName = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression);
  if (!isNodeOfType(expression, "JSXElement")) return true;
  const renderedAttributes = expression.openingElement.attributes;
  return (
    hasJsxSpreadAttribute(renderedAttributes) ||
    NAME_PROVIDING_ATTRIBUTES.some((name) => hasJsxPropIgnoreCase(renderedAttributes, name))
  );
};

const isTitleElementName = (
  elementName: EsTreeNode,
  surface: BaseUiDialogSurface,
  context: RuleContext,
): boolean => {
  if (
    resolveNamespacedPartName(
      elementName,
      surface.moduleSourcePattern,
      surface.namespaceName,
      context,
    ) === "Title"
  ) {
    return true;
  }
  const trailingSegment = getTrailingJsxNameSegment(elementName);
  return trailingSegment === "Title" || trailingSegment === `${surface.namespaceName}Title`;
};

export const baseUiDialogPopupRequiresTitle = defineRule({
  id: "base-ui-dialog-popup-requires-title",
  title: "Base UI dialog popup without a title",
  severity: "warn",
  requires: ["base-ui"],
  recommendation:
    "Give every Base UI Dialog.Popup and AlertDialog.Popup a Title part (visually hidden when the design shows no heading) or name the dialog with aria-label.",
  create: (context: RuleContext): RuleVisitors => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      for (const surface of BASE_UI_DIALOG_SURFACES) {
        if (
          resolveNamespacedPartName(
            node.name,
            surface.moduleSourcePattern,
            surface.namespaceName,
            context,
          ) !== "Popup"
        ) {
          continue;
        }
        // A spread can supply aria-label; a `render` prop swaps in an
        // element that may carry the name itself.
        if (hasJsxSpreadAttribute(node.attributes)) return;
        const renderAttribute = findJsxAttribute(node.attributes, "render");
        if (renderAttribute && renderPropMayProvideName(renderAttribute)) return;
        if (
          NAME_PROVIDING_ATTRIBUTES.some((attribute) =>
            hasJsxPropIgnoreCase(node.attributes, attribute),
          )
        ) {
          return;
        }
        const element = node.parent;
        if (!element || !isNodeOfType(element, "JSXElement") || element.children.length === 0) {
          return;
        }
        const scan = scanJsxSubtreeForPart(element.children, {
          isPartElementName: (elementName) => isTitleElementName(elementName, surface, context),
          // Same-surface parts (Close, Description, …) are known leaves; any
          // unresolved custom component may render the title itself, so the
          // claim becomes unprovable. Opaque elements still recurse, so a
          // title nested through them counts.
          isOpaqueElement: (childElement) => {
            const childName = childElement.openingElement.name;
            if (
              resolveNamespacedPartName(
                childName,
                surface.moduleSourcePattern,
                surface.namespaceName,
                context,
              ) !== null
            ) {
              return false;
            }
            const trailingSegment = getTrailingJsxNameSegment(childName);
            return (
              trailingSegment !== null &&
              /^[A-Z]/.test(trailingSegment) &&
              trailingSegment !== "Fragment"
            );
          },
        });
        if (scan.foundPart || scan.sawOpaqueContent) return;
        context.report({
          node: node.name,
          message: `This ${surface.namespaceName}.Popup renders no ${surface.namespaceName}.Title, so the dialog has no accessible name and assistive technology announces an unnamed dialog. Add a Title part (visually hidden if the design shows no heading) or an aria-label.`,
        });
        return;
      }
    },
  }),
});
