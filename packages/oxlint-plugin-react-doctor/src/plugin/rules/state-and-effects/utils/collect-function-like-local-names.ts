import { collectPatternNames } from "../../../utils/collect-pattern-names.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  getStaticMemberPropertyName,
  getStaticMemberReferenceName,
  getStaticPropertyKeyName,
  isFunctionLike,
} from "./event-handler-reference.js";

const isUseCallbackCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") && getCalleeName(node.callee) === "useCallback";

const getCalleeName = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "Identifier")) return node.name;
  if (isNodeOfType(node, "MemberExpression")) return getStaticMemberPropertyName(node);
  return null;
};

const isFunctionLikeReference = (
  node: EsTreeNode,
  functionLikeLocalNames: Set<string>,
): boolean => {
  if (isFunctionLike(node) || isUseCallbackCall(node)) return true;
  if (isNodeOfType(node, "Identifier")) return functionLikeLocalNames.has(node.name);
  const memberReferenceName = getStaticMemberReferenceName(node);
  return Boolean(memberReferenceName && functionLikeLocalNames.has(memberReferenceName));
};

const addObjectPropertyFunctionNames = (
  objectName: string,
  node: EsTreeNode,
  functionLikeLocalNames: Set<string>,
): void => {
  if (!isNodeOfType(node, "ObjectExpression")) return;
  for (const property of node.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property);
    if (!propertyName) continue;
    if (!isFunctionLikeReference(property.value, functionLikeLocalNames)) continue;
    functionLikeLocalNames.add(`${objectName}.${propertyName}`);
  }
};

const addVariableDeclarationFunctionNames = (
  statement: EsTreeNode,
  functionLikeLocalNames: Set<string>,
): void => {
  if (!isNodeOfType(statement, "VariableDeclaration")) return;
  const declaredNames = new Set<string>();
  for (const declarator of statement.declarations ?? []) {
    if (!declarator.init) continue;
    declaredNames.clear();
    collectPatternNames(declarator.id, declaredNames);
    for (const declaredName of declaredNames) {
      if (isFunctionLikeReference(declarator.init, functionLikeLocalNames)) {
        functionLikeLocalNames.add(declaredName);
      }
      addObjectPropertyFunctionNames(declaredName, declarator.init, functionLikeLocalNames);
    }
  }
};

const collectStatementFunctionNames = (
  statement: EsTreeNode,
  functionLikeLocalNames: Set<string>,
): void => {
  if (isNodeOfType(statement, "FunctionDeclaration")) {
    if (statement.id?.name) functionLikeLocalNames.add(statement.id.name);
    return;
  }

  if (isNodeOfType(statement, "VariableDeclaration")) {
    addVariableDeclarationFunctionNames(statement, functionLikeLocalNames);
    return;
  }

  if (isNodeOfType(statement, "BlockStatement")) {
    collectStatementListFunctionNames(statement.body, functionLikeLocalNames);
    return;
  }

  if (isNodeOfType(statement, "IfStatement")) {
    collectStatementFunctionNames(statement.consequent, functionLikeLocalNames);
    if (statement.alternate)
      collectStatementFunctionNames(statement.alternate, functionLikeLocalNames);
    return;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    for (const switchCase of statement.cases ?? []) {
      collectStatementListFunctionNames(switchCase.consequent, functionLikeLocalNames);
    }
    return;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    collectStatementFunctionNames(statement.block, functionLikeLocalNames);
    if (statement.handler)
      collectStatementFunctionNames(statement.handler.body, functionLikeLocalNames);
    if (statement.finalizer)
      collectStatementFunctionNames(statement.finalizer, functionLikeLocalNames);
    return;
  }

  if (
    isNodeOfType(statement, "ForStatement") ||
    isNodeOfType(statement, "ForInStatement") ||
    isNodeOfType(statement, "ForOfStatement") ||
    isNodeOfType(statement, "WhileStatement") ||
    isNodeOfType(statement, "DoWhileStatement")
  ) {
    collectStatementFunctionNames(statement.body, functionLikeLocalNames);
    return;
  }

  if (isNodeOfType(statement, "LabeledStatement")) {
    collectStatementFunctionNames(statement.body, functionLikeLocalNames);
  }
};

const collectStatementListFunctionNames = (
  statements: EsTreeNode[] | undefined,
  functionLikeLocalNames: Set<string>,
): void => {
  for (const statement of statements ?? []) {
    collectStatementFunctionNames(statement, functionLikeLocalNames);
  }
};

export const collectFunctionLikeLocalNames = (componentBody: EsTreeNode): Set<string> => {
  const functionLikeLocalNames = new Set<string>();
  if (!isNodeOfType(componentBody, "BlockStatement")) return functionLikeLocalNames;
  let previousSize = -1;
  while (previousSize !== functionLikeLocalNames.size) {
    previousSize = functionLikeLocalNames.size;
    collectStatementListFunctionNames(componentBody.body, functionLikeLocalNames);
  }
  return functionLikeLocalNames;
};
