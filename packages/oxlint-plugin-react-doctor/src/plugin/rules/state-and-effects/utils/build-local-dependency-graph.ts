import { collectPatternNames } from "../../../utils/collect-pattern-names.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { collectComponentScopeReferenceNames } from "./collect-component-scope-reference-names.js";

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
): void => {
  if (!isNodeOfType(statement, "VariableDeclaration")) return;
  for (const declarator of statement.declarations ?? []) {
    if (!declarator.init) continue;
    const dependencyNames = collectComponentScopeReferenceNames(declarator.init);
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
): void => {
  if (isNodeOfType(statement, "VariableDeclaration")) {
    addVariableDeclarationDependencies(graph, statement, declaredNames);
    return;
  }

  if (isNodeOfType(statement, "FunctionDeclaration")) {
    if (!statement.id?.name) return;
    addDependencies(graph, statement.id.name, collectComponentScopeReferenceNames(statement));
    return;
  }

  if (isNodeOfType(statement, "BlockStatement")) {
    collectStatementListDependencies(graph, statement.body, declaredNames);
    return;
  }

  if (isNodeOfType(statement, "IfStatement")) {
    collectStatementDependencies(graph, statement.consequent, declaredNames);
    if (statement.alternate)
      collectStatementDependencies(graph, statement.alternate, declaredNames);
    return;
  }

  if (isNodeOfType(statement, "SwitchStatement")) {
    for (const switchCase of statement.cases ?? []) {
      collectStatementListDependencies(graph, switchCase.consequent, declaredNames);
    }
    return;
  }

  if (isNodeOfType(statement, "TryStatement")) {
    collectStatementDependencies(graph, statement.block, declaredNames);
    if (statement.handler)
      collectStatementDependencies(graph, statement.handler.body, declaredNames);
    if (statement.finalizer)
      collectStatementDependencies(graph, statement.finalizer, declaredNames);
    return;
  }

  if (isNodeOfType(statement, "ForStatement")) {
    if (statement.init) collectStatementDependencies(graph, statement.init, declaredNames);
    collectStatementDependencies(graph, statement.body, declaredNames);
    return;
  }

  if (isNodeOfType(statement, "ForInStatement") || isNodeOfType(statement, "ForOfStatement")) {
    if (isNodeOfType(statement.left, "VariableDeclaration")) {
      addVariableDeclarationDependencies(graph, statement.left, declaredNames);
    }
    collectStatementDependencies(graph, statement.body, declaredNames);
    return;
  }

  if (isNodeOfType(statement, "WhileStatement") || isNodeOfType(statement, "DoWhileStatement")) {
    collectStatementDependencies(graph, statement.body, declaredNames);
    return;
  }

  if (isNodeOfType(statement, "LabeledStatement")) {
    collectStatementDependencies(graph, statement.body, declaredNames);
  }
};

const collectStatementListDependencies = (
  graph: Map<string, Set<string>>,
  statements: EsTreeNode[] | undefined,
  declaredNames: Set<string>,
): void => {
  for (const statement of statements ?? []) {
    collectStatementDependencies(graph, statement, declaredNames);
  }
};

export const buildLocalDependencyGraph = (componentBody: EsTreeNode): Map<string, Set<string>> => {
  const graph = new Map<string, Set<string>>();
  if (!isNodeOfType(componentBody, "BlockStatement")) return graph;
  const declaredNames = new Set<string>();
  collectStatementListDependencies(graph, componentBody.body, declaredNames);
  return graph;
};
