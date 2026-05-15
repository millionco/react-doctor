import { collectPatternNames } from "../../../utils/collect-pattern-names.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  collectComponentScopeReferenceNames,
  collectPatternDefaultReferenceNames,
} from "./collect-component-scope-reference-names.js";

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
  eventHandlerReferenceNames: Set<string>,
): Set<string> => collectPatternDefaultReferenceNames(pattern, eventHandlerReferenceNames);

const addVariableDeclarationDependencies = (
  graph: Map<string, Set<string>>,
  statement: EsTreeNode,
  declaredNames: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!isNodeOfType(statement, "VariableDeclaration")) return;
  for (const declarator of statement.declarations ?? []) {
    if (!declarator.init) continue;
    const dependencyNames = collectComponentScopeReferenceNames(
      declarator.init,
      eventHandlerReferenceNames,
    );
    addDependencyNames(
      dependencyNames,
      getPatternDefaultReferenceNames(declarator.id, eventHandlerReferenceNames),
    );
    declaredNames.clear();
    collectPatternNames(declarator.id, declaredNames);
    for (const declaredName of declaredNames) {
      addDependencies(graph, declaredName, dependencyNames);
    }
  }
};

const addAssignmentExpressionDependencies = (
  graph: Map<string, Set<string>>,
  expression: EsTreeNode,
  assignedNames: Set<string>,
  eventHandlerReferenceNames: Set<string>,
  controlDependencyNames: Set<string>,
): void => {
  if (!isNodeOfType(expression, "AssignmentExpression")) return;
  const dependencyNames = collectComponentScopeReferenceNames(
    expression.right,
    eventHandlerReferenceNames,
  );
  addDependencyNames(
    dependencyNames,
    getPatternDefaultReferenceNames(expression.left, eventHandlerReferenceNames),
  );
  addDependencyNames(dependencyNames, controlDependencyNames);
  if (expression.operator !== "=") {
    addDependencyNames(
      dependencyNames,
      collectComponentScopeReferenceNames(expression.left, eventHandlerReferenceNames),
    );
  }
  assignedNames.clear();
  collectPatternNames(expression.left, assignedNames);
  for (const assignedName of assignedNames) {
    addDependencies(graph, assignedName, dependencyNames);
  }
};

const collectExpressionDependencies = (
  graph: Map<string, Set<string>>,
  expression: EsTreeNode,
  assignedNames: Set<string>,
  eventHandlerReferenceNames: Set<string>,
  controlDependencyNames: Set<string>,
): void => {
  if (isNodeOfType(expression, "AssignmentExpression")) {
    addAssignmentExpressionDependencies(
      graph,
      expression,
      assignedNames,
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
        assignedNames,
        eventHandlerReferenceNames,
        controlDependencyNames,
      );
    }
    return;
  }

  if (isNodeOfType(expression, "ConditionalExpression")) {
    const branchControlDependencyNames = new Set(controlDependencyNames);
    addDependencyNames(
      branchControlDependencyNames,
      collectComponentScopeReferenceNames(expression.test, eventHandlerReferenceNames),
    );
    collectExpressionDependencies(
      graph,
      expression.consequent,
      assignedNames,
      eventHandlerReferenceNames,
      branchControlDependencyNames,
    );
    collectExpressionDependencies(
      graph,
      expression.alternate,
      assignedNames,
      eventHandlerReferenceNames,
      branchControlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(expression, "LogicalExpression")) {
    const rightControlDependencyNames = new Set(controlDependencyNames);
    addDependencyNames(
      rightControlDependencyNames,
      collectComponentScopeReferenceNames(expression.left, eventHandlerReferenceNames),
    );
    collectExpressionDependencies(
      graph,
      expression.right,
      assignedNames,
      eventHandlerReferenceNames,
      rightControlDependencyNames,
    );
  }
};

const collectStatementDependencies = (
  graph: Map<string, Set<string>>,
  statement: EsTreeNode,
  declaredNames: Set<string>,
  eventHandlerReferenceNames: Set<string>,
  controlDependencyNames: Set<string>,
): void => {
  if (isNodeOfType(statement, "VariableDeclaration")) {
    addVariableDeclarationDependencies(graph, statement, declaredNames, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(statement, "FunctionDeclaration")) {
    if (!statement.id?.name) return;
    addDependencies(
      graph,
      statement.id.name,
      collectComponentScopeReferenceNames(statement, eventHandlerReferenceNames),
    );
    return;
  }

  if (isNodeOfType(statement, "ExpressionStatement")) {
    collectExpressionDependencies(
      graph,
      statement.expression,
      declaredNames,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "AssignmentExpression")) {
    addAssignmentExpressionDependencies(
      graph,
      statement,
      declaredNames,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "BlockStatement")) {
    collectStatementListDependencies(
      graph,
      statement.body,
      declaredNames,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "IfStatement")) {
    const branchControlDependencyNames = new Set(controlDependencyNames);
    addDependencyNames(
      branchControlDependencyNames,
      collectComponentScopeReferenceNames(statement.test, eventHandlerReferenceNames),
    );
    collectStatementDependencies(
      graph,
      statement.consequent,
      declaredNames,
      eventHandlerReferenceNames,
      branchControlDependencyNames,
    );
    if (statement.alternate)
      collectStatementDependencies(
        graph,
        statement.alternate,
        declaredNames,
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
        collectComponentScopeReferenceNames(statement.discriminant, eventHandlerReferenceNames),
      );
      if (switchCase.test) {
        addDependencyNames(
          caseControlDependencyNames,
          collectComponentScopeReferenceNames(switchCase.test, eventHandlerReferenceNames),
        );
      }
      collectStatementListDependencies(
        graph,
        switchCase.consequent,
        declaredNames,
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
      declaredNames,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
    if (statement.handler)
      collectStatementDependencies(
        graph,
        statement.handler.body,
        declaredNames,
        eventHandlerReferenceNames,
        controlDependencyNames,
      );
    if (statement.finalizer)
      collectStatementDependencies(
        graph,
        statement.finalizer,
        declaredNames,
        eventHandlerReferenceNames,
        controlDependencyNames,
      );
    return;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    if (statement.init)
      collectStatementDependencies(
        graph,
        statement.init,
        declaredNames,
        eventHandlerReferenceNames,
        controlDependencyNames,
      );
    const loopControlDependencyNames = new Set(controlDependencyNames);
    if (statement.test) {
      addDependencyNames(
        loopControlDependencyNames,
        collectComponentScopeReferenceNames(statement.test, eventHandlerReferenceNames),
      );
    }
    collectStatementDependencies(
      graph,
      statement.body,
      declaredNames,
      eventHandlerReferenceNames,
      loopControlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "ForInStatement") || isNodeOfType(statement, "ForOfStatement")) {
    if (isNodeOfType(statement.left, "VariableDeclaration")) {
      addVariableDeclarationDependencies(
        graph,
        statement.left,
        declaredNames,
        eventHandlerReferenceNames,
      );
    }
    const loopControlDependencyNames = new Set(controlDependencyNames);
    addDependencyNames(
      loopControlDependencyNames,
      collectComponentScopeReferenceNames(statement.right, eventHandlerReferenceNames),
    );
    collectStatementDependencies(
      graph,
      statement.body,
      declaredNames,
      eventHandlerReferenceNames,
      loopControlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    const loopControlDependencyNames = new Set(controlDependencyNames);
    addDependencyNames(
      loopControlDependencyNames,
      collectComponentScopeReferenceNames(statement.test, eventHandlerReferenceNames),
    );
    collectStatementDependencies(
      graph,
      statement.body,
      declaredNames,
      eventHandlerReferenceNames,
      loopControlDependencyNames,
    );
    return;
  }

  if (isNodeOfType(statement, "LabeledStatement")) {
    collectStatementDependencies(
      graph,
      statement.body,
      declaredNames,
      eventHandlerReferenceNames,
      controlDependencyNames,
    );
  }
};

const collectStatementListDependencies = (
  graph: Map<string, Set<string>>,
  statements: EsTreeNode[] | undefined,
  declaredNames: Set<string>,
  eventHandlerReferenceNames: Set<string>,
  controlDependencyNames: Set<string>,
): void => {
  for (const statement of statements ?? []) {
    collectStatementDependencies(
      graph,
      statement,
      declaredNames,
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
  const declaredNames = new Set<string>();
  collectStatementListDependencies(
    graph,
    componentBody.body,
    declaredNames,
    eventHandlerReferenceNames,
    new Set(),
  );
  return graph;
};
