import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  getStaticMemberPropertyName,
  getStaticMemberReferenceName,
  getStaticPropertyKeyName,
  isFunctionLike,
} from "./event-handler-reference.js";
import {
  addPatternBindings,
  createBlockBindingScope,
  createComponentBindingScope,
  getVariableDeclarationScope,
  resolveBindingName,
  type BindingScope,
} from "./scope-aware-reference-names.js";

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
  scope: BindingScope,
): boolean => {
  if (isFunctionLike(node) || isUseCallbackCall(node)) return true;
  if (isNodeOfType(node, "Identifier"))
    return functionLikeLocalNames.has(resolveBindingName(scope, node.name));
  const memberReferenceName = getStaticMemberReferenceName(node, (name) =>
    resolveBindingName(scope, name),
  );
  return Boolean(memberReferenceName && functionLikeLocalNames.has(memberReferenceName));
};

const addObjectPropertyFunctionNames = (
  objectBindingName: string,
  node: EsTreeNode,
  functionLikeLocalNames: Set<string>,
  scope: BindingScope,
): void => {
  if (!isNodeOfType(node, "ObjectExpression")) return;
  for (const property of node.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property);
    if (!propertyName) continue;
    if (!isFunctionLikeReference(property.value, functionLikeLocalNames, scope)) continue;
    functionLikeLocalNames.add(`${objectBindingName}.${propertyName}`);
  }
};

const addVariableDeclarationFunctionNames = (
  statement: EsTreeNode,
  functionLikeLocalNames: Set<string>,
  scope: BindingScope,
): void => {
  if (!isNodeOfType(statement, "VariableDeclaration")) return;
  const declarationScope = getVariableDeclarationScope(statement, scope);
  for (const declarator of statement.declarations ?? []) {
    const declaredBindingNames = addPatternBindings(declarator.id, declarationScope);
    if (!declarator.init) continue;
    const isFunctionReference = isFunctionLikeReference(
      declarator.init,
      functionLikeLocalNames,
      scope,
    );
    for (const declaredBindingName of declaredBindingNames) {
      if (isFunctionReference) {
        functionLikeLocalNames.add(declaredBindingName);
      }
      addObjectPropertyFunctionNames(
        declaredBindingName,
        declarator.init,
        functionLikeLocalNames,
        scope,
      );
    }
  }
};

const collectStatementFunctionNames = (
  statement: EsTreeNode,
  functionLikeLocalNames: Set<string>,
  scope: BindingScope,
): void => {
  if (isNodeOfType(statement, "FunctionDeclaration")) {
    if (statement.id) {
      const declaredBindingNames = addPatternBindings(statement.id, scope);
      for (const declaredBindingName of declaredBindingNames) {
        functionLikeLocalNames.add(declaredBindingName);
      }
    }
    return;
  }

  if (isNodeOfType(statement, "VariableDeclaration")) {
    addVariableDeclarationFunctionNames(statement, functionLikeLocalNames, scope);
    return;
  }

  if (isNodeOfType(statement, "BlockStatement")) {
    collectStatementListFunctionNames(
      statement.body,
      functionLikeLocalNames,
      createBlockBindingScope(scope),
    );
    return;
  }

  if (isNodeOfType(statement, "IfStatement")) {
    collectStatementFunctionNames(statement.consequent, functionLikeLocalNames, scope);
    if (statement.alternate)
      collectStatementFunctionNames(statement.alternate, functionLikeLocalNames, scope);
    return;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    for (const switchCase of statement.cases ?? []) {
      collectStatementListFunctionNames(
        switchCase.consequent,
        functionLikeLocalNames,
        createBlockBindingScope(scope),
      );
    }
    return;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    collectStatementFunctionNames(statement.block, functionLikeLocalNames, scope);
    if (statement.handler) {
      const catchScope = createBlockBindingScope(scope);
      addPatternBindings(statement.handler.param, catchScope);
      collectStatementFunctionNames(statement.handler.body, functionLikeLocalNames, catchScope);
    }
    if (statement.finalizer)
      collectStatementFunctionNames(statement.finalizer, functionLikeLocalNames, scope);
    return;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    const loopScope = createBlockBindingScope(scope);
    if (statement.init && isNodeOfType(statement.init, "VariableDeclaration")) {
      addVariableDeclarationFunctionNames(statement.init, functionLikeLocalNames, loopScope);
    }
    collectStatementFunctionNames(statement.body, functionLikeLocalNames, loopScope);
    return;
  }

  if (isNodeOfType(statement, "ForInStatement") || isNodeOfType(statement, "ForOfStatement")) {
    const loopScope = createBlockBindingScope(scope);
    if (isNodeOfType(statement.left, "VariableDeclaration")) {
      addVariableDeclarationFunctionNames(statement.left, functionLikeLocalNames, loopScope);
    } else {
      addPatternBindings(statement.left, loopScope);
    }
    collectStatementFunctionNames(statement.body, functionLikeLocalNames, loopScope);
    return;
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    collectStatementFunctionNames(statement.body, functionLikeLocalNames, scope);
    return;
  }

  if (isNodeOfType(statement, "LabeledStatement")) {
    collectStatementFunctionNames(statement.body, functionLikeLocalNames, scope);
  }
};

const collectStatementListFunctionNames = (
  statements: EsTreeNode[] | undefined,
  functionLikeLocalNames: Set<string>,
  scope: BindingScope,
): void => {
  for (const statement of statements ?? []) {
    collectStatementFunctionNames(statement, functionLikeLocalNames, scope);
  }
};

export const collectFunctionLikeLocalNames = (componentBody: EsTreeNode): Set<string> => {
  const functionLikeLocalNames = new Set<string>();
  if (!isNodeOfType(componentBody, "BlockStatement")) return functionLikeLocalNames;
  let previousSize = -1;
  while (previousSize !== functionLikeLocalNames.size) {
    previousSize = functionLikeLocalNames.size;
    collectStatementListFunctionNames(
      componentBody.body,
      functionLikeLocalNames,
      createComponentBindingScope(),
    );
  }
  return functionLikeLocalNames;
};
