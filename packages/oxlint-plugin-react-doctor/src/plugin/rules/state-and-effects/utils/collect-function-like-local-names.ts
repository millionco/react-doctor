import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isInlineFunctionExpression } from "../../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../../utils/is-react-hook-call.js";
import { getStaticMemberReferenceName } from "./event-handler-reference.js";
import {
  addPatternBindings,
  createBlockBindingScope,
  createComponentBindingScope,
  getVariableDeclarationScope,
  resolveBindingName,
  type BindingScope,
} from "./scope-aware-reference-names.js";

const isFunctionLikeReference = (
  node: EsTreeNode,
  functionLikeLocalNames: Set<string>,
  scope: BindingScope,
  scopes: ScopeAnalysis,
): boolean => {
  if (isInlineFunctionExpression(node) || isReactHookCall(node, "useCallback", scopes)) return true;
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
  scopes: ScopeAnalysis,
): void => {
  if (!isNodeOfType(node, "ObjectExpression")) return;
  for (const property of node.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property, {
      stringifyNonStringLiterals: true,
    });
    if (!propertyName) continue;
    if (!isFunctionLikeReference(property.value, functionLikeLocalNames, scope, scopes)) continue;
    functionLikeLocalNames.add(`${objectBindingName}.${propertyName}`);
  }
};

const addVariableDeclarationFunctionNames = (
  statement: EsTreeNode,
  functionLikeLocalNames: Set<string>,
  scope: BindingScope,
  scopes: ScopeAnalysis,
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
      scopes,
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
        scopes,
      );
    }
  }
};

const collectStatementFunctionNames = (
  statement: EsTreeNode,
  functionLikeLocalNames: Set<string>,
  scope: BindingScope,
  scopes: ScopeAnalysis,
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
    addVariableDeclarationFunctionNames(statement, functionLikeLocalNames, scope, scopes);
    return;
  }

  if (isNodeOfType(statement, "BlockStatement")) {
    collectStatementListFunctionNames(
      statement.body,
      functionLikeLocalNames,
      createBlockBindingScope(scope),
      scopes,
    );
    return;
  }

  if (isNodeOfType(statement, "IfStatement")) {
    collectStatementFunctionNames(statement.consequent, functionLikeLocalNames, scope, scopes);
    if (statement.alternate)
      collectStatementFunctionNames(statement.alternate, functionLikeLocalNames, scope, scopes);
    return;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    for (const switchCase of statement.cases ?? []) {
      collectStatementListFunctionNames(
        switchCase.consequent,
        functionLikeLocalNames,
        createBlockBindingScope(scope),
        scopes,
      );
    }
    return;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    collectStatementFunctionNames(statement.block, functionLikeLocalNames, scope, scopes);
    if (statement.handler) {
      const catchScope = createBlockBindingScope(scope);
      addPatternBindings(statement.handler.param, catchScope);
      collectStatementFunctionNames(
        statement.handler.body,
        functionLikeLocalNames,
        catchScope,
        scopes,
      );
    }
    if (statement.finalizer)
      collectStatementFunctionNames(statement.finalizer, functionLikeLocalNames, scope, scopes);
    return;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    const loopScope = createBlockBindingScope(scope);
    if (statement.init && isNodeOfType(statement.init, "VariableDeclaration")) {
      addVariableDeclarationFunctionNames(
        statement.init,
        functionLikeLocalNames,
        loopScope,
        scopes,
      );
    }
    collectStatementFunctionNames(statement.body, functionLikeLocalNames, loopScope, scopes);
    return;
  }

  if (isNodeOfType(statement, "ForInStatement") || isNodeOfType(statement, "ForOfStatement")) {
    const loopScope = createBlockBindingScope(scope);
    if (isNodeOfType(statement.left, "VariableDeclaration")) {
      addVariableDeclarationFunctionNames(
        statement.left,
        functionLikeLocalNames,
        loopScope,
        scopes,
      );
    } else {
      addPatternBindings(statement.left, loopScope);
    }
    collectStatementFunctionNames(statement.body, functionLikeLocalNames, loopScope, scopes);
    return;
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    collectStatementFunctionNames(statement.body, functionLikeLocalNames, scope, scopes);
    return;
  }

  if (isNodeOfType(statement, "LabeledStatement")) {
    collectStatementFunctionNames(statement.body, functionLikeLocalNames, scope, scopes);
  }
};

const collectStatementListFunctionNames = (
  statements: EsTreeNode[] | undefined,
  functionLikeLocalNames: Set<string>,
  scope: BindingScope,
  scopes: ScopeAnalysis,
): void => {
  for (const statement of statements ?? []) {
    collectStatementFunctionNames(statement, functionLikeLocalNames, scope, scopes);
  }
};

export const collectFunctionLikeLocalNames = (
  componentBody: EsTreeNode,
  scopes: ScopeAnalysis,
): Set<string> => {
  const functionLikeLocalNames = new Set<string>();
  if (!isNodeOfType(componentBody, "BlockStatement")) return functionLikeLocalNames;
  let previousSize = -1;
  while (previousSize !== functionLikeLocalNames.size) {
    previousSize = functionLikeLocalNames.size;
    collectStatementListFunctionNames(
      componentBody.body,
      functionLikeLocalNames,
      createComponentBindingScope(),
      scopes,
    );
  }
  return functionLikeLocalNames;
};
