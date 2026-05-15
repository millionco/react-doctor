import { collectPatternNames } from "../../../utils/collect-pattern-names.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isAstNode } from "../../../utils/is-ast-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

const copyScope = (scope: Set<string>): Set<string> => new Set(scope);

const addPatternNames = (pattern: EsTreeNode | null | undefined, scope: Set<string>): void => {
  if (!pattern) return;
  collectPatternNames(pattern, scope);
};

const visitPatternDefaultValues = (
  pattern: EsTreeNode | null | undefined,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!pattern) return;
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    visitNode(pattern.right, names, scope, eventHandlerReferenceNames);
    visitPatternDefaultValues(pattern.left, names, scope, eventHandlerReferenceNames);
    return;
  }
  if (isNodeOfType(pattern, "RestElement")) {
    visitPatternDefaultValues(pattern.argument, names, scope, eventHandlerReferenceNames);
    return;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements ?? []) {
      visitPatternDefaultValues(element, names, scope, eventHandlerReferenceNames);
    }
    return;
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties ?? []) {
      if (isNodeOfType(property, "RestElement")) {
        visitPatternDefaultValues(property.argument, names, scope, eventHandlerReferenceNames);
        continue;
      }
      if (isNodeOfType(property, "Property")) {
        visitPatternDefaultValues(property.value, names, scope, eventHandlerReferenceNames);
      }
    }
  }
};

const visitChildren = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) visitNode(item, names, scope, eventHandlerReferenceNames);
      }
      continue;
    }
    if (isAstNode(child)) visitNode(child, names, scope, eventHandlerReferenceNames);
  }
};

const visitFunction = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (
    !isNodeOfType(node, "FunctionDeclaration") &&
    !isNodeOfType(node, "FunctionExpression") &&
    !isNodeOfType(node, "ArrowFunctionExpression")
  ) {
    return;
  }

  const functionScope = copyScope(scope);
  if (isNodeOfType(node, "FunctionDeclaration") || isNodeOfType(node, "FunctionExpression")) {
    if (node.id) functionScope.add(node.id.name);
  }
  for (const param of node.params ?? []) {
    visitPatternDefaultValues(param, names, functionScope, eventHandlerReferenceNames);
    addPatternNames(param, functionScope);
  }
  visitNode(node.body, names, functionScope, eventHandlerReferenceNames);
};

const visitVariableDeclaration = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!isNodeOfType(node, "VariableDeclaration")) return;
  for (const declarator of node.declarations ?? []) {
    if (declarator.init) visitNode(declarator.init, names, scope, eventHandlerReferenceNames);
    visitPatternDefaultValues(declarator.id, names, scope, eventHandlerReferenceNames);
    addPatternNames(declarator.id, scope);
  }
};

const visitProperty = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!isNodeOfType(node, "Property")) return;
  const propertyName = getStaticPropertyKeyName(node);
  if (
    propertyName &&
    isEventHandlerName(propertyName) &&
    isEventHandlerValue(node.value, eventHandlerReferenceNames)
  ) {
    return;
  }
  if (node.computed) visitNode(node.key, names, scope, eventHandlerReferenceNames);
  visitNode(node.value, names, scope, eventHandlerReferenceNames);
};

const isFunctionLike = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionExpression") || isNodeOfType(node, "ArrowFunctionExpression");

const isEventHandlerName = (name: string): boolean => /^on[A-Z]/.test(name);

const isEventHandlerValue = (node: EsTreeNode, eventHandlerReferenceNames: Set<string>): boolean =>
  isFunctionLike(node) ||
  (isNodeOfType(node, "Identifier") && eventHandlerReferenceNames.has(node.name));

const getStaticPropertyKeyName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "Property")) return null;
  if (node.computed) return null;
  if (isNodeOfType(node.key, "Identifier")) return node.key.name;
  if (isNodeOfType(node.key, "Literal")) return String(node.key.value);
  return null;
};

const visitMemberExpression = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!isNodeOfType(node, "MemberExpression")) return;
  visitNode(node.object, names, scope, eventHandlerReferenceNames);
  if (node.computed) visitNode(node.property, names, scope, eventHandlerReferenceNames);
};

const visitBlockStatement = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!isNodeOfType(node, "BlockStatement")) return;
  const blockScope = copyScope(scope);
  for (const statement of node.body ?? []) {
    visitNode(statement, names, blockScope, eventHandlerReferenceNames);
  }
};

const visitForStatement = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!isNodeOfType(node, "ForStatement")) return;
  const loopScope = copyScope(scope);
  if (node.init) visitNode(node.init, names, loopScope, eventHandlerReferenceNames);
  if (node.test) visitNode(node.test, names, loopScope, eventHandlerReferenceNames);
  if (node.update) visitNode(node.update, names, loopScope, eventHandlerReferenceNames);
  visitNode(node.body, names, loopScope, eventHandlerReferenceNames);
};

const visitForInOrOfStatement = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!isNodeOfType(node, "ForInStatement") && !isNodeOfType(node, "ForOfStatement")) return;
  const loopScope = copyScope(scope);
  if (isNodeOfType(node.left, "VariableDeclaration")) {
    visitNode(node.right, names, loopScope, eventHandlerReferenceNames);
    for (const declarator of node.left.declarations ?? [])
      addPatternNames(declarator.id, loopScope);
  } else {
    visitNode(node.right, names, loopScope, eventHandlerReferenceNames);
    addPatternNames(node.left, loopScope);
  }
  visitNode(node.body, names, loopScope, eventHandlerReferenceNames);
};

const visitCatchClause = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!isNodeOfType(node, "CatchClause")) return;
  const catchScope = copyScope(scope);
  addPatternNames(node.param, catchScope);
  visitNode(node.body, names, catchScope, eventHandlerReferenceNames);
};

const visitJsxAttribute = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!isNodeOfType(node, "JSXAttribute")) return;
  const attributeName = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : null;
  if (!node.value) return;
  if (attributeName && isEventHandlerName(attributeName) && isIntrinsicJsxAttribute(node)) return;
  if (
    attributeName &&
    isEventHandlerName(attributeName) &&
    isNodeOfType(node.value, "JSXExpressionContainer") &&
    isEventHandlerValue(node.value.expression, eventHandlerReferenceNames)
  ) {
    return;
  }
  visitNode(node.value, names, scope, eventHandlerReferenceNames);
};

const isIntrinsicJsxAttribute = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "JSXAttribute")) return false;
  const openingElement = node.parent;
  if (!isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  const elementName = openingElement.name;
  if (!isNodeOfType(elementName, "JSXIdentifier")) return false;
  return /^[a-z]/.test(elementName.name);
};

const visitNode = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (isNodeOfType(node, "Identifier")) {
    if (!scope.has(node.name)) names.add(node.name);
    return;
  }

  if (
    isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression")
  ) {
    visitFunction(node, names, scope, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(node, "BlockStatement")) {
    visitBlockStatement(node, names, scope, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(node, "VariableDeclaration")) {
    visitVariableDeclaration(node, names, scope, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(node, "Property")) {
    visitProperty(node, names, scope, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(node, "MemberExpression")) {
    visitMemberExpression(node, names, scope, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(node, "ForStatement")) {
    visitForStatement(node, names, scope, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(node, "ForInStatement") || isNodeOfType(node, "ForOfStatement")) {
    visitForInOrOfStatement(node, names, scope, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(node, "CatchClause")) {
    visitCatchClause(node, names, scope, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(node, "JSXAttribute")) {
    visitJsxAttribute(node, names, scope, eventHandlerReferenceNames);
    return;
  }

  visitChildren(node, names, scope, eventHandlerReferenceNames);
};

export const collectPatternDefaultReferenceNames = (
  pattern: EsTreeNode,
  eventHandlerReferenceNames: Set<string> = new Set(),
): Set<string> => {
  const names = new Set<string>();
  visitPatternDefaultValues(pattern, names, new Set(), eventHandlerReferenceNames);
  return names;
};

export const collectComponentScopeReferenceNames = (
  node: EsTreeNode,
  eventHandlerReferenceNames: Set<string> = new Set(),
): Set<string> => {
  const names = new Set<string>();
  visitNode(node, names, new Set(), eventHandlerReferenceNames);
  return names;
};
