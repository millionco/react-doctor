import { collectPatternNames } from "../../../utils/collect-pattern-names.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isAstNode } from "../../../utils/is-ast-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

const copyScope = (scope: Set<string>): Set<string> => new Set(scope);

const addPatternNames = (pattern: EsTreeNode | null | undefined, scope: Set<string>): void => {
  if (!pattern) return;
  collectPatternNames(pattern, scope);
};

const visitChildren = (node: EsTreeNode, names: Set<string>, scope: Set<string>): void => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) visitNode(item, names, scope);
      }
      continue;
    }
    if (isAstNode(child)) visitNode(child, names, scope);
  }
};

const visitFunction = (node: EsTreeNode, names: Set<string>, scope: Set<string>): void => {
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
  for (const param of node.params ?? []) addPatternNames(param, functionScope);
  visitNode(node.body, names, functionScope);
};

const visitVariableDeclaration = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
): void => {
  if (!isNodeOfType(node, "VariableDeclaration")) return;
  for (const declarator of node.declarations ?? []) {
    if (declarator.init) visitNode(declarator.init, names, scope);
    addPatternNames(declarator.id, scope);
  }
};

const visitProperty = (node: EsTreeNode, names: Set<string>, scope: Set<string>): void => {
  if (!isNodeOfType(node, "Property")) return;
  const propertyName = getStaticPropertyKeyName(node);
  if (propertyName && /^on[A-Z]/.test(propertyName)) return;
  if (node.computed) visitNode(node.key, names, scope);
  visitNode(node.value, names, scope);
};

const getStaticPropertyKeyName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "Property")) return null;
  if (node.computed) return null;
  if (isNodeOfType(node.key, "Identifier")) return node.key.name;
  if (isNodeOfType(node.key, "Literal")) return String(node.key.value);
  return null;
};

const visitMemberExpression = (node: EsTreeNode, names: Set<string>, scope: Set<string>): void => {
  if (!isNodeOfType(node, "MemberExpression")) return;
  visitNode(node.object, names, scope);
  if (node.computed) visitNode(node.property, names, scope);
};

const visitBlockStatement = (node: EsTreeNode, names: Set<string>, scope: Set<string>): void => {
  if (!isNodeOfType(node, "BlockStatement")) return;
  const blockScope = copyScope(scope);
  for (const statement of node.body ?? []) visitNode(statement, names, blockScope);
};

const visitForStatement = (node: EsTreeNode, names: Set<string>, scope: Set<string>): void => {
  if (!isNodeOfType(node, "ForStatement")) return;
  const loopScope = copyScope(scope);
  if (node.init) visitNode(node.init, names, loopScope);
  if (node.test) visitNode(node.test, names, loopScope);
  if (node.update) visitNode(node.update, names, loopScope);
  visitNode(node.body, names, loopScope);
};

const visitForInOrOfStatement = (
  node: EsTreeNode,
  names: Set<string>,
  scope: Set<string>,
): void => {
  if (!isNodeOfType(node, "ForInStatement") && !isNodeOfType(node, "ForOfStatement")) return;
  const loopScope = copyScope(scope);
  if (isNodeOfType(node.left, "VariableDeclaration")) {
    visitNode(node.right, names, loopScope);
    for (const declarator of node.left.declarations ?? [])
      addPatternNames(declarator.id, loopScope);
  } else {
    visitNode(node.right, names, loopScope);
    addPatternNames(node.left, loopScope);
  }
  visitNode(node.body, names, loopScope);
};

const visitCatchClause = (node: EsTreeNode, names: Set<string>, scope: Set<string>): void => {
  if (!isNodeOfType(node, "CatchClause")) return;
  const catchScope = copyScope(scope);
  addPatternNames(node.param, catchScope);
  visitNode(node.body, names, catchScope);
};

const visitJsxAttribute = (node: EsTreeNode, names: Set<string>, scope: Set<string>): void => {
  if (!isNodeOfType(node, "JSXAttribute")) return;
  const attributeName = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : null;
  if (attributeName && /^on[A-Z]/.test(attributeName)) return;
  if (node.value) visitNode(node.value, names, scope);
};

const visitNode = (node: EsTreeNode, names: Set<string>, scope: Set<string>): void => {
  if (isNodeOfType(node, "Identifier")) {
    if (!scope.has(node.name)) names.add(node.name);
    return;
  }

  if (
    isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression")
  ) {
    visitFunction(node, names, scope);
    return;
  }

  if (isNodeOfType(node, "BlockStatement")) {
    visitBlockStatement(node, names, scope);
    return;
  }

  if (isNodeOfType(node, "VariableDeclaration")) {
    visitVariableDeclaration(node, names, scope);
    return;
  }

  if (isNodeOfType(node, "Property")) {
    visitProperty(node, names, scope);
    return;
  }

  if (isNodeOfType(node, "MemberExpression")) {
    visitMemberExpression(node, names, scope);
    return;
  }

  if (isNodeOfType(node, "ForStatement")) {
    visitForStatement(node, names, scope);
    return;
  }

  if (isNodeOfType(node, "ForInStatement") || isNodeOfType(node, "ForOfStatement")) {
    visitForInOrOfStatement(node, names, scope);
    return;
  }

  if (isNodeOfType(node, "CatchClause")) {
    visitCatchClause(node, names, scope);
    return;
  }

  if (isNodeOfType(node, "JSXAttribute")) {
    visitJsxAttribute(node, names, scope);
    return;
  }

  visitChildren(node, names, scope);
};

export const collectComponentScopeReferenceNames = (node: EsTreeNode): Set<string> => {
  const names = new Set<string>();
  visitNode(node, names, new Set());
  return names;
};
