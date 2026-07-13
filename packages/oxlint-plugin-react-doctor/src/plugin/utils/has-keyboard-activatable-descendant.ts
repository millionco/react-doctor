import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { areExpressionsStructurallyEqual } from "./are-expressions-structurally-equal.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { flattenJsxName } from "./flatten-jsx-name.js";
import { hasJsxPropIgnoreCase } from "./has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "./is-hidden-from-screen-reader.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const NATIVE_KEYBOARD_ACTIVATABLE_TAGS: ReadonlySet<string> = new Set([
  "a",
  "button",
  "input",
  "select",
  "summary",
  "textarea",
]);
const KEYBOARD_ACTIVATABLE_COMPONENT_NAME_PATTERN = /button|link|nav|anchor/i;
const DESCENDANT_ACTION_PROP_NAMES = ["onClick", "onPress"] as const;

const isStaticallyNullish = (expression: EsTreeNode): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "Literal")) return strippedExpression.value === null;
  if (isNodeOfType(strippedExpression, "Identifier")) {
    return strippedExpression.name === "undefined";
  }
  return (
    isNodeOfType(strippedExpression, "UnaryExpression") && strippedExpression.operator === "void"
  );
};

const resolveSingleHandlerAction = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): EsTreeNode | null => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "ConditionalExpression")) {
    const consequent = strippedExpression.consequent as EsTreeNode;
    const alternate = strippedExpression.alternate as EsTreeNode;
    if (isStaticallyNullish(consequent)) {
      return resolveSingleHandlerAction(alternate, scopes, visitedSymbolIds);
    }
    if (isStaticallyNullish(alternate)) {
      return resolveSingleHandlerAction(consequent, scopes, visitedSymbolIds);
    }
    return null;
  }
  if (isNodeOfType(strippedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(strippedExpression);
    if (symbol?.kind === "const" && symbol.initializer && !visitedSymbolIds.has(symbol.id)) {
      visitedSymbolIds.add(symbol.id);
      return resolveSingleHandlerAction(symbol.initializer, scopes, visitedSymbolIds);
    }
    return strippedExpression;
  }
  if (
    isNodeOfType(strippedExpression, "ArrowFunctionExpression") ||
    isNodeOfType(strippedExpression, "FunctionExpression") ||
    isNodeOfType(strippedExpression, "FunctionDeclaration")
  ) {
    const body = stripParenExpression(strippedExpression.body);
    if (!isNodeOfType(body, "BlockStatement")) return body;
    if (body.body.length !== 1) return null;
    const statement = body.body[0];
    if (isNodeOfType(statement, "ExpressionStatement")) return statement.expression as EsTreeNode;
    if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
      return stripParenExpression(statement.argument as EsTreeNode);
    }
    return null;
  }
  return strippedExpression;
};

const getAttributeAction = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  return resolveSingleHandlerAction(attribute.value.expression as EsTreeNode, scopes);
};

const hasPotentiallyTruthyAttribute = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): boolean => {
  const attribute = hasJsxPropIgnoreCase(openingElement.attributes, attributeName);
  if (!attribute) return false;
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) return attribute.value.value === true;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression as EsTreeNode);
  return !isNodeOfType(expression, "Literal") || expression.value !== false;
};

const hasAccessibleNameEvidence = (element: EsTreeNodeOfType<"JSXElement">): boolean => {
  if (
    hasJsxPropIgnoreCase(element.openingElement.attributes, "aria-label") ||
    hasJsxPropIgnoreCase(element.openingElement.attributes, "aria-labelledby")
  ) {
    return true;
  }
  return element.children.some((child) => {
    const childNode = child as EsTreeNode;
    if (isNodeOfType(childNode, "JSXText")) return childNode.value.trim().length > 0;
    return isNodeOfType(childNode, "JSXExpressionContainer");
  });
};

const isKeyboardActivatableElement = (
  element: EsTreeNodeOfType<"JSXElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
  requiresAccessibleName: boolean,
): boolean => {
  const openingElement = element.openingElement;
  const elementName = flattenJsxName(openingElement.name as EsTreeNode);
  if (!elementName) return false;
  const isNativeElement = HTML_TAGS.has(elementName);
  if (
    (isNativeElement && !NATIVE_KEYBOARD_ACTIVATABLE_TAGS.has(elementName)) ||
    (!isNativeElement && !KEYBOARD_ACTIVATABLE_COMPONENT_NAME_PATTERN.test(elementName))
  ) {
    return false;
  }
  if (elementName === "a" && !hasJsxPropIgnoreCase(openingElement.attributes, "href")) {
    return false;
  }
  if (
    hasPotentiallyTruthyAttribute(openingElement, "disabled") ||
    hasPotentiallyTruthyAttribute(openingElement, "isDisabled") ||
    isHiddenFromScreenReader(openingElement, settings)
  ) {
    return false;
  }
  return !requiresAccessibleName || hasAccessibleNameEvidence(element);
};

const findKeyboardActivatableDescendant = (
  node: EsTreeNode,
  expectedAction: EsTreeNode | null,
  scopes: ScopeAnalysis,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  if (isNodeOfType(node, "JSXElement")) {
    if (isKeyboardActivatableElement(node, settings, expectedAction !== null)) {
      if (!expectedAction) return true;
      for (const actionPropName of DESCENDANT_ACTION_PROP_NAMES) {
        const attribute = hasJsxPropIgnoreCase(node.openingElement.attributes, actionPropName);
        const action = attribute ? getAttributeAction(attribute, scopes) : null;
        if (action && areExpressionsStructurallyEqual(expectedAction, action)) return true;
      }
    }
    return node.children.some((child) =>
      findKeyboardActivatableDescendant(child as EsTreeNode, expectedAction, scopes, settings),
    );
  }
  if (isNodeOfType(node, "JSXFragment")) {
    return node.children.some((child) =>
      findKeyboardActivatableDescendant(child as EsTreeNode, expectedAction, scopes, settings),
    );
  }
  if (isNodeOfType(node, "JSXExpressionContainer")) {
    return findKeyboardActivatableDescendant(
      node.expression as EsTreeNode,
      expectedAction,
      scopes,
      settings,
    );
  }
  if (isNodeOfType(node, "LogicalExpression")) {
    return (
      findKeyboardActivatableDescendant(node.left, expectedAction, scopes, settings) ||
      findKeyboardActivatableDescendant(node.right, expectedAction, scopes, settings)
    );
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      findKeyboardActivatableDescendant(
        node.consequent as EsTreeNode,
        expectedAction,
        scopes,
        settings,
      ) ||
      findKeyboardActivatableDescendant(
        node.alternate as EsTreeNode,
        expectedAction,
        scopes,
        settings,
      )
    );
  }
  return false;
};

export const hasKeyboardActivatableDescendant = (
  element: EsTreeNode | null | undefined,
  interactionAttribute: EsTreeNodeOfType<"JSXAttribute"> | null,
  scopes: ScopeAnalysis,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  if (!element || !isNodeOfType(element, "JSXElement")) return false;
  const expectedAction = interactionAttribute
    ? getAttributeAction(interactionAttribute, scopes)
    : null;
  if (interactionAttribute && !expectedAction) return false;
  return element.children.some((child) =>
    findKeyboardActivatableDescendant(child as EsTreeNode, expectedAction, scopes, settings),
  );
};
