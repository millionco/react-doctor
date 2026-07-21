import { VALID_ARIA_ROLES } from "../../constants/aria-roles.js";
import { canExpressionOverrideJsxAttribute } from "../../utils/can-expression-override-jsx-attribute.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { getStaticStringExpression } from "../../utils/get-static-string-expression.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isLiteralVoidExpression } from "../../utils/is-literal-void-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { jsxAttributeMayHaveNonEmptyValue } from "../../utils/jsx-attribute-may-have-non-empty-value.js";
import { objectHasAccessibleChild } from "../../utils/object-has-accessible-child.js";
import { resolveStaticJsxAttribute } from "../../utils/resolve-static-jsx-attribute.js";
import type { StaticJsxAttributeResolution } from "../../utils/resolve-static-jsx-attribute.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const DATA_TABLE_ROLES = new Set(["grid", "table", "treegrid"]);
const hasSpreadThatMayAffectAttribute = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
  context: RuleContext,
): boolean => {
  for (
    let attributeIndex = openingElement.attributes.length - 1;
    attributeIndex >= 0;
    attributeIndex -= 1
  ) {
    const attribute = openingElement.attributes[attributeIndex];
    if (!attribute) continue;
    if (isNodeOfType(attribute, "JSXAttribute")) {
      if (getJsxAttributeName(attribute.name)?.toLowerCase() === attributeName) return false;
      continue;
    }
    if (!isNodeOfType(attribute, "JSXSpreadAttribute")) continue;
    if (
      canExpressionOverrideJsxAttribute(attribute.argument, attributeName, false, context.scopes)
    ) {
      return true;
    }
  }
  return false;
};

const resolutionIsUnknown = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
  resolution: StaticJsxAttributeResolution,
  context: RuleContext,
): boolean =>
  resolution.isUnknown && hasSpreadThatMayAffectAttribute(openingElement, attributeName, context);

const getResolutionStaticString = (resolution: StaticJsxAttributeResolution): string | null =>
  resolution.attribute
    ? getStringLiteralAttributeValue(resolution.attribute)
    : getStaticStringExpression(resolution.expression);

const resolutionMayHaveNonEmptyValue = (
  resolution: StaticJsxAttributeResolution,
  booleanValuesRender: boolean,
  context: RuleContext,
): boolean => {
  if (resolution.attribute) {
    return jsxAttributeMayHaveNonEmptyValue(resolution.attribute, {
      booleanValuesRender,
      scopes: context.scopes,
    });
  }
  if (!resolution.expression) return false;
  const expression = stripParenExpression(resolution.expression);
  const staticStringValue = getStaticStringExpression(expression);
  if (staticStringValue !== null) return staticStringValue.trim().length > 0;
  if (isNodeOfType(expression, "Literal")) {
    return (
      (typeof expression.value === "boolean" && booleanValuesRender) ||
      typeof expression.value === "number"
    );
  }
  if (isLiteralVoidExpression(expression)) return false;
  if (
    isNodeOfType(expression, "Identifier") &&
    expression.name === "undefined" &&
    context.scopes.isGlobalReference(expression)
  ) {
    return false;
  }
  return true;
};

const hasPotentialAccessibleNameAttribute = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean | null => {
  for (const attributeName of ["aria-label", "aria-labelledby", "title"]) {
    const resolution = resolveStaticJsxAttribute(openingElement.attributes, attributeName, false);
    if (resolutionIsUnknown(openingElement, attributeName, resolution, context)) return null;
    if (resolutionMayHaveNonEmptyValue(resolution, attributeName.startsWith("aria-"), context)) {
      return true;
    }
  }
  return false;
};

const getDirectCaption = (
  children: ReadonlyArray<EsTreeNode>,
): EsTreeNodeOfType<"JSXElement"> | null => {
  for (const child of children) {
    if (
      isNodeOfType(child, "JSXElement") &&
      resolveJsxElementType(child.openingElement) === "caption"
    ) {
      return child;
    }
    if (isNodeOfType(child, "JSXFragment")) {
      const caption = getDirectCaption(child.children);
      if (caption) return caption;
    }
  }
  return null;
};

const captionMayProvideAccessibleName = (
  caption: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  if (isHiddenFromScreenReader(caption.openingElement, context.settings)) return false;
  return objectHasAccessibleChild(caption, context.settings);
};

const tableHasExposedHeader = (
  header: EsTreeNodeOfType<"JSXOpeningElement">,
  table: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = header.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      if (isHiddenFromScreenReader(ancestor.openingElement, context.settings)) return false;
      if (resolveJsxElementType(ancestor.openingElement) === "table") return ancestor === table;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const hasHiddenAncestor = (
  table: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  let ancestor = table.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      isHiddenFromScreenReader(ancestor.openingElement, context.settings)
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const dataTableRequiresAccessibleName = defineRule({
  id: "data-table-requires-accessible-name",
  title: "Data table has no accessible name",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Give data tables a concise caption, or reference an existing visible title with aria-labelledby.",
  create: (context: RuleContext) => {
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        const openingElement = node.openingElement;
        if (
          resolveJsxElementType(openingElement) !== "table" ||
          isGeneratedImageRenderContext(context, openingElement) ||
          isHiddenFromScreenReader(openingElement, context.settings) ||
          hasHiddenAncestor(node, context)
        ) {
          return;
        }
        const unresolvedSemanticAttribute = [
          "aria-hidden",
          "children",
          "dangerouslysetinnerhtml",
          "hidden",
        ].some((attributeName) => {
          const resolution = resolveStaticJsxAttribute(
            openingElement.attributes,
            attributeName,
            false,
          );
          return resolutionIsUnknown(openingElement, attributeName, resolution, context);
        });
        if (unresolvedSemanticAttribute) return;
        const childrenResolution = resolveStaticJsxAttribute(
          openingElement.attributes,
          "children",
          false,
        );
        const inlineHtmlResolution = resolveStaticJsxAttribute(
          openingElement.attributes,
          "dangerouslysetinnerhtml",
          false,
        );
        if (childrenResolution.isPresent || inlineHtmlResolution.isPresent) return;
        const roleResolution = resolveStaticJsxAttribute(openingElement.attributes, "role", false);
        if (resolutionIsUnknown(openingElement, "role", roleResolution, context)) return;
        if (roleResolution.isPresent) {
          const role = getResolutionStaticString(roleResolution);
          if (role === null) {
            if (resolutionMayHaveNonEmptyValue(roleResolution, false, context)) return;
          } else {
            const primaryRole = role
              .trim()
              .toLowerCase()
              .split(/\s+/)
              .find((roleToken) => VALID_ARIA_ROLES.has(roleToken));
            if (primaryRole && !DATA_TABLE_ROLES.has(primaryRole)) return;
          }
        }
        const descendants = getStaticJsxDescendantOpeningElements(node);
        if (
          !descendants.some(
            (descendant) =>
              resolveJsxElementType(descendant) === "th" &&
              tableHasExposedHeader(descendant, node, context),
          )
        ) {
          return;
        }
        const caption = getDirectCaption(node.children);
        const accessibleNameAttribute = hasPotentialAccessibleNameAttribute(
          openingElement,
          context,
        );
        if (accessibleNameAttribute === null) return;
        if (
          (caption && captionMayProvideAccessibleName(caption, context)) ||
          accessibleNameAttribute
        ) {
          return;
        }
        context.report({
          node: openingElement,
          message:
            "This data table has headers but no accessible name. Add a caption or connect the table to a visible title with aria-labelledby.",
        });
      },
    };
  },
});
