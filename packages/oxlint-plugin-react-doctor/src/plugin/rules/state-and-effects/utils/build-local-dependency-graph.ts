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
    for (const defaultReferenceName of collectPatternDefaultReferenceNames(
      declarator.id,
      eventHandlerReferenceNames,
    )) {
      dependencyNames.add(defaultReferenceName);
    }
    declaredNames.clear();
    collectPatternNames(declarator.id, declaredNames);
    for (const declaredName of declaredNames) {
      addDependencies(graph, declaredName, dependencyNames);
    }
  }
};

const collectStatementDependencies = (
  graph: Map<string, Set<string>>,
  statement: EsTreeNode,
  declaredNames: Set<string>,
  eventHandlerReferenceNames: Set<string>,
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

  if (isNodeOfType(statement, "BlockStatement")) {
    collectStatementListDependencies(
      graph,
      statement.body,
      declaredNames,
      eventHandlerReferenceNames,
    );
    return;
  }

  if (isNodeOfType(statement, "IfStatement")) {
    collectStatementDependencies(
      graph,
      statement.consequent,
      declaredNames,
      eventHandlerReferenceNames,
    );
    if (statement.alternate)
      collectStatementDependencies(
        graph,
        statement.alternate,
        declaredNames,
        eventHandlerReferenceNames,
      );
    return;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    for (const switchCase of statement.cases ?? []) {
      collectStatementListDependencies(
        graph,
        switchCase.consequent,
        declaredNames,
        eventHandlerReferenceNames,
      );
    }
    return;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    collectStatementDependencies(graph, statement.block, declaredNames, eventHandlerReferenceNames);
    if (statement.handler)
      collectStatementDependencies(
        graph,
        statement.handler.body,
        declaredNames,
        eventHandlerReferenceNames,
      );
    if (statement.finalizer)
      collectStatementDependencies(
        graph,
        statement.finalizer,
        declaredNames,
        eventHandlerReferenceNames,
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
      );
    collectStatementDependencies(graph, statement.body, declaredNames, eventHandlerReferenceNames);
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
    collectStatementDependencies(graph, statement.body, declaredNames, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    collectStatementDependencies(graph, statement.body, declaredNames, eventHandlerReferenceNames);
    return;
  }

  if (isNodeOfType(statement, "LabeledStatement")) {
    collectStatementDependencies(graph, statement.body, declaredNames, eventHandlerReferenceNames);
  }
};

const collectStatementListDependencies = (
  graph: Map<string, Set<string>>,
  statements: EsTreeNode[] | undefined,
  declaredNames: Set<string>,
  eventHandlerReferenceNames: Set<string>,
): void => {
  for (const statement of statements ?? []) {
    collectStatementDependencies(graph, statement, declaredNames, eventHandlerReferenceNames);
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
  );
  return graph;
};
