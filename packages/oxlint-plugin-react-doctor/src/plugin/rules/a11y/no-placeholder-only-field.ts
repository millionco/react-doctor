import { defineRule } from "../../utils/define-rule.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadThatMayProvideAttribute } from "../../utils/has-jsx-spread-that-may-provide-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isLiteralVoidExpression } from "../../utils/is-literal-void-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { jsxAttributeMayHaveNonEmptyValue } from "../../utils/jsx-attribute-may-have-non-empty-value.js";
import { objectHasAccessibleChild } from "../../utils/object-has-accessible-child.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { nodesCanCoExecute } from "../../utils/nodes-can-co-execute.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "date",
  "datetime-local",
  "file",
  "hidden",
  "image",
  "month",
  "radio",
  "range",
  "reset",
  "submit",
  "time",
  "week",
]);
const LABELABLE_ELEMENT_NAMES = new Set([
  "button",
  "input",
  "meter",
  "output",
  "progress",
  "select",
  "textarea",
]);
const WINDMILL_REACT_UI_PACKAGE = "@windmill/react-ui";
const WINDMILL_LABEL_EXPORT = "Label";

interface PlaceholderFieldCandidate {
  readonly id: string | null;
  readonly node: EsTreeNodeOfType<"JSXOpeningElement">;
  readonly owner: EsTreeNode | null;
}

const getOpeningElementName = (node: EsTreeNodeOfType<"JSXOpeningElement">): string | null =>
  isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : null;

const isInsideHiddenSubtree = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      isHiddenFromScreenReader(ancestor.openingElement, settings)
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const getStaticAssociationValue = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  context: RuleContext,
): string | null | undefined => {
  if (!attribute.value) return null;
  const staticStringValue = getStringLiteralAttributeValue(attribute);
  if (staticStringValue !== null) return staticStringValue;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return undefined;
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal")) {
    if (expression.value === null || typeof expression.value === "boolean") return null;
    return String(expression.value);
  }
  if (isLiteralVoidExpression(expression)) return null;
  if (
    isNodeOfType(expression, "Identifier") &&
    expression.name === "undefined" &&
    context.scopes.isGlobalReference(expression)
  ) {
    return null;
  }
  return undefined;
};

const inputIsHidden = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (getOpeningElementName(node) !== "input") return false;
  const typeAttribute = getAuthoritativeJsxAttribute(node.attributes, "type", false);
  return typeAttribute
    ? getStringLiteralAttributeValue(typeAttribute)?.toLowerCase() === "hidden"
    : false;
};

const getFirstStaticLabelableDescendant = (
  label: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXOpeningElement"> | null =>
  getStaticJsxDescendantOpeningElements(label).find((descendant) => {
    const elementName = getOpeningElementName(descendant);
    return Boolean(
      elementName && LABELABLE_ELEMENT_NAMES.has(elementName) && !inputIsHidden(descendant),
    );
  }) ?? null;

const labelMayOwnNestedField = (
  label: EsTreeNodeOfType<"JSXElement">,
  field: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const htmlForAttribute =
    getAuthoritativeJsxAttribute(label.openingElement.attributes, "htmlFor", false) ??
    getAuthoritativeJsxAttribute(label.openingElement.attributes, "for", false);
  if (!htmlForAttribute) {
    const firstLabelableDescendant = getFirstStaticLabelableDescendant(label);
    return firstLabelableDescendant === null || firstLabelableDescendant === field;
  }
  const htmlForValue = getStaticAssociationValue(htmlForAttribute, context);
  if (htmlForValue === undefined) return true;
  if (htmlForValue === null || htmlForValue.length === 0) return false;
  const idAttribute = getAuthoritativeJsxAttribute(field.attributes, "id", false);
  if (!idAttribute) return false;
  const fieldId = getStaticAssociationValue(idAttribute, context);
  return fieldId === undefined || fieldId === htmlForValue;
};

const hasPossibleEnclosingLabel = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const ancestorName = getOpeningElementName(ancestor.openingElement);
      if (ancestorName === "label") {
        return (
          !isHiddenFromScreenReader(ancestor.openingElement, context.settings) &&
          labelMayOwnNestedField(ancestor, node, context) &&
          objectHasAccessibleChild(ancestor, context.settings, node)
        );
      }
      if (ancestorName !== null && isNodeOfType(ancestor.openingElement.name, "JSXIdentifier")) {
        const symbol = context.scopes.symbolFor(ancestor.openingElement.name);
        if (symbol?.kind === "import") {
          const importBinding = getImportBindingForName(ancestor.openingElement.name, ancestorName);
          if (
            importBinding?.source === WINDMILL_REACT_UI_PACKAGE &&
            importBinding.exportedName === WINDMILL_LABEL_EXPORT &&
            !isHiddenFromScreenReader(ancestor.openingElement, context.settings) &&
            objectHasAccessibleChild(ancestor, context.settings, node)
          ) {
            return true;
          }
        }
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const noPlaceholderOnlyField = defineRule({
  id: "no-placeholder-only-field",
  title: "Field relies on placeholder text for its label",
  tags: ["test-noise"],
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Add a visible label associated with the field. Keep placeholder text for examples or formatting hints.",
  create: (context: RuleContext) => {
    const labelNodesByControlIdByOwner = new Map<
      EsTreeNode | null,
      Map<string, EsTreeNodeOfType<"JSXOpeningElement">[]>
    >();
    const fieldCandidates: PlaceholderFieldCandidate[] = [];

    const recordLabelAssociation = (
      node: EsTreeNodeOfType<"JSXOpeningElement">,
      controlId: string,
    ): void => {
      const owner = findEnclosingFunction(node);
      const labelNodesByControlId = labelNodesByControlIdByOwner.get(owner) ?? new Map();
      const labelNodes = labelNodesByControlId.get(controlId) ?? [];
      labelNodes.push(node);
      labelNodesByControlId.set(controlId, labelNodes);
      labelNodesByControlIdByOwner.set(owner, labelNodesByControlId);
    };

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementName = getOpeningElementName(node);
        const htmlForAttribute =
          getAuthoritativeJsxAttribute(node.attributes, "htmlFor", false) ??
          getAuthoritativeJsxAttribute(node.attributes, "for", false);
        const htmlForValue = htmlForAttribute
          ? getStaticAssociationValue(htmlForAttribute, context)
          : null;
        const isCustomElement =
          isNodeOfType(node.name, "JSXMemberExpression") ||
          (elementName !== null && elementName[0] !== elementName[0]?.toLowerCase());

        if (isCustomElement) {
          if (htmlForValue && !isInsideHiddenSubtree(node, context.settings)) {
            recordLabelAssociation(node, htmlForValue);
          }
          return;
        }

        if (elementName === "label") {
          if (
            htmlForValue &&
            isNodeOfType(node.parent, "JSXElement") &&
            !isInsideHiddenSubtree(node, context.settings) &&
            objectHasAccessibleChild(node.parent, context.settings)
          ) {
            recordLabelAssociation(node, htmlForValue);
          }
          return;
        }

        if (elementName !== "input" && elementName !== "textarea") return;
        if (isInsideHiddenSubtree(node, context.settings)) return;
        if (hasPossibleEnclosingLabel(node, context)) return;
        for (const attributeName of ["aria-label", "aria-labelledby"]) {
          const accessibleNameAttribute = getAuthoritativeJsxAttribute(
            node.attributes,
            attributeName,
            false,
          );
          if (accessibleNameAttribute) {
            if (
              jsxAttributeMayHaveNonEmptyValue(accessibleNameAttribute, {
                booleanValuesRender: true,
                scopes: context.scopes,
              })
            ) {
              return;
            }
          } else if (hasJsxSpreadThatMayProvideAttribute(node.attributes, attributeName)) {
            return;
          }
        }

        if (elementName === "input") {
          const typeAttribute = getAuthoritativeJsxAttribute(node.attributes, "type", false);
          if (!typeAttribute && hasJsxSpreadThatMayProvideAttribute(node.attributes, "type")) {
            return;
          }
          if (typeAttribute) {
            const inputType = getStringLiteralAttributeValue(typeAttribute);
            if (inputType === null) return;
            if (inputType && NON_TEXT_INPUT_TYPES.has(inputType.toLowerCase())) return;
          }
        }

        const placeholderAttribute = getAuthoritativeJsxAttribute(
          node.attributes,
          "placeholder",
          false,
        );
        if (!placeholderAttribute) return;
        const placeholderValue = getStringLiteralAttributeValue(placeholderAttribute)?.trim();
        if (!placeholderValue) return;

        const idAttribute = getAuthoritativeJsxAttribute(node.attributes, "id", false);
        if (!idAttribute && hasJsxSpreadThatMayProvideAttribute(node.attributes, "id")) return;
        const idValue = idAttribute ? getStaticAssociationValue(idAttribute, context) : null;
        if (idValue === undefined) return;
        fieldCandidates.push({ id: idValue || null, node, owner: findEnclosingFunction(node) });
      },
      "Program:exit"() {
        for (const candidate of fieldCandidates) {
          const matchingLabelNodes = candidate.id
            ? (labelNodesByControlIdByOwner.get(candidate.owner)?.get(candidate.id) ?? [])
            : [];
          if (
            matchingLabelNodes.some((labelNode) =>
              nodesCanCoExecute(labelNode, candidate.node, context),
            )
          ) {
            continue;
          }
          context.report({
            node: candidate.node,
            message:
              "Placeholder text disappears during entry and cannot replace a persistent field label. Add a visible associated label.",
          });
        }
      },
    };
  },
});
