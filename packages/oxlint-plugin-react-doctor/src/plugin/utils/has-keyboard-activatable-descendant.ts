import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { areExpressionsStructurallyEqual } from "./are-expressions-structurally-equal.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { flattenJsxName } from "./flatten-jsx-name.js";
import { hasJsxPropIgnoreCase } from "./has-jsx-prop-ignore-case.js";
import { isHiddenFromScreenReader } from "./is-hidden-from-screen-reader.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNullishExpression } from "./is-nullish-expression.js";
import { parseJsxValue } from "./parse-jsx-value.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
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
const EQUIVALENT_ACTION_COMPONENT_NAME_PATTERN = /(?:button|link|anchor)$/i;
const UPPERCASE_COMPONENT_NAME_PATTERN = /^[A-Z]/;
const DESCENDANT_ACTION_PROP_NAMES = ["onClick", "onPress"] as const;

const isStaticallyNullish = (expression: EsTreeNode): boolean =>
  isNullishExpression(stripParenExpression(expression));

const isStaticallyNullishHandlerExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (isNullishExpression(strippedExpression)) return true;
  const symbol = resolveConstIdentifierAlias(strippedExpression, scopes);
  if (symbol?.kind !== "const" || !symbol.initializer) return false;
  return isNullishExpression(stripParenExpression(symbol.initializer));
};

const resolveSingleHandlerAction = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): EsTreeNode | null => {
  const strippedExpression = stripParenExpression(expression);
  if (isStaticallyNullishHandlerExpression(strippedExpression, scopes)) return null;
  if (isNodeOfType(strippedExpression, "ConditionalExpression")) {
    const consequent = strippedExpression.consequent as EsTreeNode;
    const alternate = strippedExpression.alternate as EsTreeNode;
    if (isStaticallyNullishHandlerExpression(consequent, scopes)) {
      return resolveSingleHandlerAction(alternate, scopes, visitedSymbolIds);
    }
    if (isStaticallyNullishHandlerExpression(alternate, scopes)) {
      return resolveSingleHandlerAction(consequent, scopes, visitedSymbolIds);
    }
    return null;
  }
  if (isNodeOfType(strippedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(strippedExpression);
    if (
      symbol?.kind === "const" &&
      symbol.initializer &&
      isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
      isNodeOfType(symbol.declarationNode.id, "Identifier") &&
      !visitedSymbolIds.has(symbol.id)
    ) {
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
  if (isNodeOfType(attribute.value, "Literal")) {
    return attribute.value.value === true || attribute.value.value === "true";
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression as EsTreeNode);
  return !isNodeOfType(expression, "Literal") || expression.value !== false;
};

const hasPotentiallyNonEmptyAttribute = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): boolean => {
  const attribute = hasJsxPropIgnoreCase(openingElement.attributes, attributeName);
  if (!attribute?.value) return false;
  if (isNodeOfType(attribute.value, "Literal")) {
    return typeof attribute.value.value === "string" && attribute.value.value.trim().length > 0;
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression as EsTreeNode);
  if (isNodeOfType(expression, "Literal")) {
    return typeof expression.value === "string" && expression.value.trim().length > 0;
  }
  return !isStaticallyNullish(expression);
};

const childMayProvideAccessibleName = (child: EsTreeNode): boolean => {
  if (isNodeOfType(child, "JSXText")) return child.value.trim().length > 0;
  if (isNodeOfType(child, "JSXElement")) return hasAccessibleNameEvidence(child);
  if (isNodeOfType(child, "JSXFragment")) {
    return child.children.some((nestedChild) =>
      childMayProvideAccessibleName(nestedChild as EsTreeNode),
    );
  }
  if (!isNodeOfType(child, "JSXExpressionContainer")) return false;
  const expression = stripParenExpression(child.expression as EsTreeNode);
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "string") return expression.value.trim().length > 0;
    return typeof expression.value === "number";
  }
  if (isStaticallyNullish(expression)) return false;
  if (isNodeOfType(expression, "JSXElement")) return hasAccessibleNameEvidence(expression);
  if (isNodeOfType(expression, "JSXFragment")) {
    return expression.children.some((nestedChild) =>
      childMayProvideAccessibleName(nestedChild as EsTreeNode),
    );
  }
  return true;
};

const hasAccessibleNameEvidence = (element: EsTreeNodeOfType<"JSXElement">): boolean => {
  if (
    hasPotentiallyNonEmptyAttribute(element.openingElement, "aria-label") ||
    hasPotentiallyNonEmptyAttribute(element.openingElement, "aria-labelledby")
  ) {
    return true;
  }
  return element.children.some((child) => childMayProvideAccessibleName(child as EsTreeNode));
};

const hasNegativeStaticTabIndex = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const tabIndexAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "tabIndex");
  if (!tabIndexAttribute?.value) return false;
  const tabIndexValue = parseJsxValue(tabIndexAttribute.value);
  return tabIndexValue !== null && tabIndexValue < 0;
};

const isHiddenSubtreeRoot = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean =>
  isHiddenFromScreenReader(openingElement, settings) ||
  hasPotentiallyTruthyAttribute(openingElement, "hidden");

const isKeyboardActivatableElement = (
  element: EsTreeNodeOfType<"JSXElement">,
  requiresAccessibleName: boolean,
): boolean => {
  const openingElement = element.openingElement;
  const elementName = flattenJsxName(openingElement.name as EsTreeNode);
  if (!elementName) return false;
  const isNativeElement = HTML_TAGS.has(elementName);
  if (isNativeElement) {
    if (!NATIVE_KEYBOARD_ACTIVATABLE_TAGS.has(elementName)) return false;
  } else if (requiresAccessibleName) {
    if (
      !UPPERCASE_COMPONENT_NAME_PATTERN.test(elementName) ||
      !EQUIVALENT_ACTION_COMPONENT_NAME_PATTERN.test(elementName)
    ) {
      return false;
    }
  } else if (
    !UPPERCASE_COMPONENT_NAME_PATTERN.test(elementName) ||
    !KEYBOARD_ACTIVATABLE_COMPONENT_NAME_PATTERN.test(elementName)
  ) {
    return false;
  }
  if (!requiresAccessibleName) return true;
  if (elementName === "a" && !hasJsxPropIgnoreCase(openingElement.attributes, "href")) {
    return false;
  }
  if (
    hasPotentiallyTruthyAttribute(openingElement, "disabled") ||
    hasPotentiallyTruthyAttribute(openingElement, "isDisabled") ||
    hasPotentiallyTruthyAttribute(openingElement, "aria-disabled") ||
    hasNegativeStaticTabIndex(openingElement)
  ) {
    return false;
  }
  return hasAccessibleNameEvidence(element);
};

const findKeyboardActivatableDescendant = (
  node: EsTreeNode,
  expectedAction: EsTreeNode | null,
  scopes: ScopeAnalysis,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  const walk = (descendant: EsTreeNode): boolean =>
    findKeyboardActivatableDescendant(descendant, expectedAction, scopes, settings);
  if (isNodeOfType(node, "JSXElement")) {
    if (expectedAction && isHiddenSubtreeRoot(node.openingElement, settings)) return false;
    if (isKeyboardActivatableElement(node, expectedAction !== null)) {
      if (!expectedAction) return true;
      for (const actionPropName of DESCENDANT_ACTION_PROP_NAMES) {
        const attribute = hasJsxPropIgnoreCase(node.openingElement.attributes, actionPropName);
        const action = attribute ? getAttributeAction(attribute, scopes) : null;
        if (action && areExpressionsStructurallyEqual(expectedAction, action)) return true;
      }
    }
    return node.children.some((child) => walk(child as EsTreeNode));
  }
  if (isNodeOfType(node, "JSXFragment")) {
    return node.children.some((child) => walk(child as EsTreeNode));
  }
  if (!expectedAction) return false;
  if (isNodeOfType(node, "JSXExpressionContainer")) return walk(node.expression as EsTreeNode);
  if (isNodeOfType(node, "LogicalExpression")) return walk(node.left) || walk(node.right);
  if (isNodeOfType(node, "ConditionalExpression")) {
    return walk(node.consequent as EsTreeNode) || walk(node.alternate as EsTreeNode);
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
