import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../../utils/is-proven-intrinsic-jsx-element.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { RESOURCE_KEY_STACK_LAYOUT_PROPERTIES } from "./constants.js";

const isChildrenConsumer = (element: EsTreeNode, context: RuleContext): boolean => {
  if (isNodeOfType(element, "JSXFragment")) return true;
  if (!isNodeOfType(element, "JSXElement")) return false;
  const opening = element.openingElement;
  if (!isNodeOfType(opening.name, "JSXIdentifier")) return false;
  if (/^[a-z]+$/.test(opening.name.name) && isProvenIntrinsicJsxElement(opening, context.scopes))
    return opening.attributes.every(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        attribute.name.name !== "children" &&
        attribute.name.name !== "dangerouslySetInnerHTML",
    );
  const symbol = context.scopes.symbolFor(opening.name);
  if (!symbol) return false;
  const declaration = getImportDeclarationForSymbol(symbol);
  return Boolean(
    declaration &&
    !isTypeOnlyImport(declaration) &&
    declaration.source.value === "@mui/material" &&
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    symbol.declarationNode.importKind !== "type" &&
    getImportedName(symbol.declarationNode) === "Stack" &&
    symbol.references.every((reference) => {
      const parent = reference.identifier.parent;
      return (
        reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
        parent.name === reference.identifier
      );
    }) &&
    opening.attributes.every((attribute) => {
      if (
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        !RESOURCE_KEY_STACK_LAYOUT_PROPERTIES.has(attribute.name.name)
      )
        return false;
      const value = isNodeOfType(attribute.value, "JSXExpressionContainer")
        ? attribute.value.expression
        : attribute.value;
      return (
        isNodeOfType(value, "Literal") &&
        (typeof value.value === "string" || typeof value.value === "number")
      );
    }),
  );
};

export const isResourceKeyRenderedChild = (
  expression: EsTreeNode,
  frame: EsTreeNode,
  context: RuleContext,
): boolean => {
  let current = findTransparentExpressionRoot(expression);
  while (current.parent) {
    const parent = current.parent;
    if (
      isNodeOfType(parent, "ReturnStatement") &&
      parent.argument === current &&
      findEnclosingFunction(parent) === frame
    )
      return true;
    if (isNodeOfType(frame, "ArrowFunctionExpression") && frame.body === current) return true;
    if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === current) {
      const consumer = parent.parent;
      if (
        !consumer ||
        (!isNodeOfType(consumer, "JSXElement") && !isNodeOfType(consumer, "JSXFragment")) ||
        !consumer.children.some((child) => child === parent) ||
        !isChildrenConsumer(consumer, context)
      )
        return false;
      current = consumer;
      continue;
    }
    if (
      (isNodeOfType(current, "JSXElement") || isNodeOfType(current, "JSXFragment")) &&
      (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
      parent.children.some((child) => child === current) &&
      isChildrenConsumer(parent, context)
    ) {
      current = parent;
      continue;
    }
    return false;
  }
  return false;
};
