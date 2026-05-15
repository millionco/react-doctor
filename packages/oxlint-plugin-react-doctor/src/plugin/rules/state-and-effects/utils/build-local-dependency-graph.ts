import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  addPatternBindings,
  collectPatternAssignmentNames,
  collectScopedPatternDefaultReferenceNames,
  collectScopedReferenceNames,
  createBlockBindingScope,
  createComponentBindingScope,
  getVariableDeclarationScope,
  type BindingScope,
} from "./scope-aware-reference-names.js";

const addDependencies = (
  graph: Map<string, Set<string>>,
  declaredName: string,
  dependencyNames: Set<string>,
): void => {
  const existing = graph.get(declaredName);
  if (existing === undefined) {
    graph.set(declaredName, new Set(dependencyNames));
    return;
  }
  for (const dependencyName of dependencyNames) existing.add(dependencyName);
};

const addDependencyNames = (into: Set<string>, dependencyNames: Set<string>): void => {
  for (const dependencyName of dependencyNames) into.add(dependencyName);
};

const getPatternDefaultReferenceNames = (
  pattern: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> =>
  collectScopedPatternDefaultReferenceNames(pattern, scope, eventHandlerReferenceNames);

const addVariableDeclarationDependencies = (
  graph: Map<string, Set<string>>,
  statement: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!isNodeOfType(statement, "VariableDeclaration")) return;
  const declarationScope = getVariableDeclarationScope(statement, scope);
  for (const declarator of statement.declarations ?? []) {
    const dependencyNames = declarator.init
      ? collectScopedReferenceNames(declarator.init, scope, eventHandlerReferenceNames)
      : new Set<string>();
    addDependencyNames(
      dependencyNames,
      getPatternDefaultReferenceNames(declarator.id, scope, eventHandlerReferenceNames),
    );
    const declaredNames = addPatternBindings(declarator.id, declarationScope);
    for (const declaredName of declaredNames) {
      addDependencies(graph, declaredName, dependencyNames);
    }
  }
};

const addAssignmentExpressionDependencies = (
  graph: Map<string, Set<string>>,
  expression: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
  controlDependencyNames: Set<string>,
): void => {
  if (!isNodeOfType(expression, "AssignmentExpression")) return;
  const dependencyNames = collectScopedReferenceNames(
    expression.right,
    scope,
    eventHandlerReferenceNames,
  );
  addDependencyNames(
    dependencyNames,
    getPatternDefaultReferenceNames(expression.left, scope, eventHandlerReferenceNames),
  );
  addDependencyNames(dependencyNames, controlDependencyNames);
  if (expression.operator !== "=") {
    addDependencyNames(
      dependencyNames,
      collectScopedReferenceNames(expression.left, scope, eventHandlerReferenceNames),
    );
  }
  const assignedNames = collectPatternAssignmentNames(expression.left, scope);
  for (const assignedName of assignedNames) {
    addDependencies(graph, assignedName, dependencyNames);
  }
};

const collectExpressionDependencies = (
  graph: Map<string, Set<string>>,
  expression: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
  controlDependencyNames: Set<string>,
): void => {
  if (isNodeOfType(expression, "AssignmentExpression")) {
    addAssignmentExpressionDependencies(
      graph,
      expression,
      scope,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(expression, "SequenceExpression")) {
    for (const subExpression of expression.expressions ?? []) {
      collectExpressionDependencies(
        graph,
        subExpression,
        scope,
        eventHandlerReferenceNames,
        controlDependencyNames,
      );
    }
    return;
  }

  if (isNodeOfType(expression, "ConditionalExpression")) {
    collectExpressionDependencies(
      graph,
      expression.test,
      scope,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    const branchControlDependencyNames = new Set(controlDependencyNames);
    addDependencyNames(
      branchControlDependencyNames,
      collectScopedReferenceNames(expression.test, scope, eventHandlerReferenceNames),
    );
    collectExpressionDependencies(
      graph,
      expression.consequent,
      scope,
      eventHandlerReferenceNames,
      branchControlDependencyNames,
    );
    collectExpressionDependencies(
      graph,
      expression.alternate,
      scope,
      eventHandlerReferenceNames,
      branchControlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(expression, "LogicalExpression")) {
    collectExpressionDependencies(
      graph,
      expression.left,
      scope,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    const rightControlDependencyNames = new Set(controlDependencyNames);
    addDependencyNames(
      rightControlDependencyNames,
      collectScopedReferenceNames(expression.left, scope, eventHandlerReferenceNames),
    );
    collectExpressionDependencies(
      graph,
      expression.right,
      scope,
      eventHandlerReferenceNames,
      rightControlDependencyNames,
    );
  }
};

const collectStatementDependencies = (
  graph: Map<string, Set<string>>,
  statement: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
  controlDependencyNames: Set<string>,
): void => {
  if (isNodeOfType(statement, "VariableDeclaration")) {
    addVariableDeclarationDependencies(graph, statement, scope, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(statement, "FunctionDeclaration")) {
    if (!statement.id?.name) return;
    const declaredNames = addPatternBindings(statement.id, scope);
    const declaredName = declaredNames.values().next().value;
    if (!declaredName) return;
    addDependencies(
      graph,
      declaredName,
      collectScopedReferenceNames(statement, scope, eventHandlerReferenceNames),
    );
    return;
  }

  if (isNodeOfType(statement, "ExpressionStatement")) {
    collectExpressionDependencies(
      graph,
      statement.expression,
      scope,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "AssignmentExpression")) {
    addAssignmentExpressionDependencies(
      graph,
      statement,
      scope,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "BlockStatement")) {
    const blockScope = createBlockBindingScope(scope);
    collectStatementListDependencies(
      graph,
      statement.body,
      blockScope,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "IfStatement")) {
    const branchControlDependencyNames = new Set(controlDependencyNames);
    addDependencyNames(
      branchControlDependencyNames,
      collectScopedReferenceNames(statement.test, scope, eventHandlerReferenceNames),
    );
    collectStatementDependencies(
      graph,
      statement.consequent,
      scope,
      eventHandlerReferenceNames,
      branchControlDependencyNames,
    );
    if (statement.alternate)
      collectStatementDependencies(
        graph,
        statement.alternate,
        scope,
        eventHandlerReferenceNames,
        branchControlDependencyNames,
      );
    return;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    for (const switchCase of statement.cases ?? []) {
      const caseControlDependencyNames = new Set(controlDependencyNames);
      addDependencyNames(
        caseControlDependencyNames,
        collectScopedReferenceNames(statement.discriminant, scope, eventHandlerReferenceNames),
      );
      if (switchCase.test) {
        addDependencyNames(
          caseControlDependencyNames,
          collectScopedReferenceNames(switchCase.test, scope, eventHandlerReferenceNames),
        );
      }
      const caseScope = createBlockBindingScope(scope);
      collectStatementListDependencies(
        graph,
        switchCase.consequent,
        caseScope,
        eventHandlerReferenceNames,
        caseControlDependencyNames,
      );
    }
    return;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    collectStatementDependencies(
      graph,
      statement.block,
      scope,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    if (statement.handler)
      collectStatementDependencies(
        graph,
        statement.handler,
        scope,
        eventHandlerReferenceNames,
        controlDependencyNames,
      );
    if (statement.finalizer)
      collectStatementDependencies(
        graph,
        statement.finalizer,
        scope,
        eventHandlerReferenceNames,
        controlDependencyNames,
      );
    return;
  }

  if (isNodeOfType(statement, "CatchClause")) {
    const catchScope = createBlockBindingScope(scope);
    addPatternBindings(statement.param, catchScope);
    collectStatementDependencies(
      graph,
      statement.body,
      catchScope,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    const loopScope = createBlockBindingScope(scope);
    if (statement.init)
      collectStatementDependencies(
        graph,
        statement.init,
        loopScope,
        eventHandlerReferenceNames,
        controlDependencyNames,
      );
    const loopControlDependencyNames = new Set(controlDependencyNames);
    if (statement.test) {
      addDependencyNames(
        loopControlDependencyNames,
        collectScopedReferenceNames(statement.test, loopScope, eventHandlerReferenceNames),
      );
    }
    collectStatementDependencies(
      graph,
      statement.body,
      loopScope,
      eventHandlerReferenceNames,
      loopControlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "ForInStatement") || isNodeOfType(statement, "ForOfStatement")) {
    const loopControlDependencyNames = new Set(controlDependencyNames);
    addDependencyNames(
      loopControlDependencyNames,
      collectScopedReferenceNames(statement.right, scope, eventHandlerReferenceNames),
    );
    const loopScope = createBlockBindingScope(scope);
    if (isNodeOfType(statement.left, "VariableDeclaration")) {
      addVariableDeclarationDependencies(
        graph,
        statement.left,
        loopScope,
        eventHandlerReferenceNames,
      );
    }
    collectStatementDependencies(
      graph,
      statement.body,
      loopScope,
      eventHandlerReferenceNames,
      loopControlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    const loopControlDependencyNames = new Set(controlDependencyNames);
    addDependencyNames(
      loopControlDependencyNames,
      collectScopedReferenceNames(statement.test, scope, eventHandlerReferenceNames),
    );
    collectStatementDependencies(
      graph,
      statement.body,
      scope,
      eventHandlerReferenceNames,
      loopControlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "LabeledStatement")) {
    collectStatementDependencies(
      graph,
      statement.body,
      scope,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
  }
};

const collectStatementListDependencies = (
  graph: Map<string, Set<string>>,
  statements: EsTreeNode[] | undefined,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
  controlDependencyNames: Set<string>,
): void => {
  for (const statement of statements ?? []) {
    collectStatementDependencies(
      graph,
      statement,
      scope,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
  }
};

export const buildLocalDependencyGraph = (
  componentBody: EsTreeNode,
  eventHandlerReferenceNames: Set<string> = new Set(),
): Map<string, Set<string>> => {
  const graph = new Map<string, Set<string>>();
  if (!isNodeOfType(componentBody, "BlockStatement")) return graph;
  const scope = createComponentBindingScope();
  collectStatementListDependencies(
    graph,
    componentBody.body,
    scope,
    eventHandlerReferenceNames,
    new Set(),
  );
  return graph;
};
