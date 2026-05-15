import { collectPatternNames } from "../../../utils/collect-pattern-names.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isAstNode } from "../../../utils/is-ast-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  getStaticPropertyKeyName,
  isEventHandlerName,
  isEventHandlerValue,
  isIntrinsicJsxAttribute,
} from "./event-handler-reference.js";

export interface BindingScope {
  bindings: Map<string, string>;
  functionScope: BindingScope | null;
  isComponentScope: boolean;
  parent: BindingScope | null;
}

export const createComponentBindingScope = (): BindingScope => {
  const scope: BindingScope = {
    bindings: new Map<string, string>(),
    functionScope: null,
    isComponentScope: true,
    parent: null,
  };
  scope.functionScope = scope;
  return scope;
};

export const createBlockBindingScope = (parent: BindingScope): BindingScope => ({
  bindings: new Map<string, string>(),
  functionScope: parent.functionScope ?? parent,
  isComponentScope: false,
  parent,
});

const createFunctionBindingScope = (parent: BindingScope): BindingScope => {
  const scope: BindingScope = {
    bindings: new Map<string, string>(),
    functionScope: null,
    isComponentScope: false,
    parent,
  };
  scope.functionScope = scope;
  return scope;
};

const getBindingKey = (name: string, pattern: EsTreeNode, scope: BindingScope): string => {
  if (scope.isComponentScope) return name;
  const rangeStart = pattern.range?.[0];
  if (rangeStart !== undefined) return `${name}@${rangeStart}`;
  const locationStart = pattern.loc?.start;
  return locationStart ? `${name}@${locationStart.line}:${locationStart.column}` : name;
};

export const resolveBindingName = (scope: BindingScope, name: string): string => {
  let currentScope: BindingScope | null = scope;
  while (currentScope) {
    const bindingName = currentScope.bindings.get(name);
    if (bindingName) return bindingName;
    currentScope = currentScope.parent;
  }
  return name;
};

export const addPatternBindings = (
  pattern: EsTreeNode | null | undefined,
  scope: BindingScope,
): Set<string> => {
  const bindingNames = new Set<string>();
  if (!pattern) return bindingNames;
  collectPatternNames(pattern, bindingNames);
  const resolvedBindingNames = new Set<string>();
  for (const bindingName of bindingNames) {
    const resolvedBindingName = getBindingKey(bindingName, pattern, scope);
    scope.bindings.set(bindingName, resolvedBindingName);
    resolvedBindingNames.add(resolvedBindingName);
  }
  return resolvedBindingNames;
};

export const getVariableDeclarationScope = (
  declaration: EsTreeNode,
  scope: BindingScope,
): BindingScope => {
  if (isNodeOfType(declaration, "VariableDeclaration") && declaration.kind === "var") {
    return scope.functionScope ?? scope;
  }
  return scope;
};

const addNames = (into: Set<string>, names: Set<string>): void => {
  for (const name of names) into.add(name);
};

const collectPatternDefaultNames = (
  pattern: EsTreeNode | null | undefined,
  names: Set<string>,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): void => {
  if (!pattern) return;
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    addNames(names, collectScopedReferenceNames(pattern.right, scope, eventHandlerReferenceNames));
    collectPatternDefaultNames(pattern.left, names, scope, eventHandlerReferenceNames);
    return;
  }
  if (isNodeOfType(pattern, "RestElement")) {
    collectPatternDefaultNames(pattern.argument, names, scope, eventHandlerReferenceNames);
    return;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements ?? []) {
      collectPatternDefaultNames(element, names, scope, eventHandlerReferenceNames);
    }
    return;
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties ?? []) {
      if (isNodeOfType(property, "RestElement")) {
        collectPatternDefaultNames(property.argument, names, scope, eventHandlerReferenceNames);
        continue;
      }
      if (isNodeOfType(property, "Property")) {
        collectPatternDefaultNames(property.value, names, scope, eventHandlerReferenceNames);
      }
    }
  }
};

export const collectScopedPatternDefaultReferenceNames = (
  pattern: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  const names = new Set<string>();
  collectPatternDefaultNames(pattern, names, scope, eventHandlerReferenceNames);
  return names;
};

export const collectPatternAssignmentNames = (
  pattern: EsTreeNode,
  scope: BindingScope,
): Set<string> => {
  const names = new Set<string>();
  collectPatternNames(pattern, names);
  const resolvedNames = new Set<string>();
  for (const name of names) resolvedNames.add(resolveBindingName(scope, name));
  return resolvedNames;
};

const collectChildrenReferenceNames = (
  node: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  const names = new Set<string>();
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item))
          addNames(names, collectScopedReferenceNames(item, scope, eventHandlerReferenceNames));
      }
      continue;
    }
    if (isAstNode(child))
      addNames(names, collectScopedReferenceNames(child, scope, eventHandlerReferenceNames));
  }
  return names;
};

const collectFunctionReferenceNames = (
  node: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  if (
    !isNodeOfType(node, "FunctionDeclaration") &&
    !isNodeOfType(node, "FunctionExpression") &&
    !isNodeOfType(node, "ArrowFunctionExpression")
  ) {
    return new Set();
  }
  const functionScope = createFunctionBindingScope(scope);
  if (isNodeOfType(node, "FunctionDeclaration") || isNodeOfType(node, "FunctionExpression")) {
    if (node.id)
      functionScope.bindings.set(node.id.name, getBindingKey(node.id.name, node.id, functionScope));
  }
  const names = new Set<string>();
  for (const param of node.params ?? []) {
    addNames(
      names,
      collectScopedPatternDefaultReferenceNames(param, functionScope, eventHandlerReferenceNames),
    );
    addPatternBindings(param, functionScope);
  }
  addNames(
    names,
    collectScopedReferenceNames(node.body, functionScope, eventHandlerReferenceNames),
  );
  return names;
};

const collectVariableDeclarationReferenceNames = (
  node: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  if (!isNodeOfType(node, "VariableDeclaration")) return new Set();
  const names = new Set<string>();
  const declarationScope = getVariableDeclarationScope(node, scope);
  for (const declarator of node.declarations ?? []) {
    if (declarator.init) {
      addNames(
        names,
        collectScopedReferenceNames(declarator.init, scope, eventHandlerReferenceNames),
      );
    }
    addNames(
      names,
      collectScopedPatternDefaultReferenceNames(declarator.id, scope, eventHandlerReferenceNames),
    );
    addPatternBindings(declarator.id, declarationScope);
  }
  return names;
};

const collectPropertyReferenceNames = (
  node: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  if (!isNodeOfType(node, "Property")) return new Set();
  const propertyName = getStaticPropertyKeyName(node);
  if (
    propertyName &&
    isEventHandlerName(propertyName) &&
    isEventHandlerValue(node.value, eventHandlerReferenceNames, (name) =>
      resolveBindingName(scope, name),
    )
  ) {
    return new Set();
  }
  const names = new Set<string>();
  if (node.computed)
    addNames(names, collectScopedReferenceNames(node.key, scope, eventHandlerReferenceNames));
  addNames(names, collectScopedReferenceNames(node.value, scope, eventHandlerReferenceNames));
  return names;
};

const collectMemberExpressionReferenceNames = (
  node: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  if (!isNodeOfType(node, "MemberExpression")) return new Set();
  const names = collectScopedReferenceNames(node.object, scope, eventHandlerReferenceNames);
  if (node.computed) {
    addNames(names, collectScopedReferenceNames(node.property, scope, eventHandlerReferenceNames));
  }
  return names;
};

const collectBlockStatementReferenceNames = (
  node: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  if (!isNodeOfType(node, "BlockStatement")) return new Set();
  const names = new Set<string>();
  const blockScope = createBlockBindingScope(scope);
  for (const statement of node.body ?? []) {
    addNames(names, collectScopedReferenceNames(statement, blockScope, eventHandlerReferenceNames));
  }
  return names;
};

const collectForStatementReferenceNames = (
  node: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  if (!isNodeOfType(node, "ForStatement")) return new Set();
  const names = new Set<string>();
  const loopScope = createBlockBindingScope(scope);
  if (node.init)
    addNames(names, collectScopedReferenceNames(node.init, loopScope, eventHandlerReferenceNames));
  if (node.test)
    addNames(names, collectScopedReferenceNames(node.test, loopScope, eventHandlerReferenceNames));
  if (node.update)
    addNames(
      names,
      collectScopedReferenceNames(node.update, loopScope, eventHandlerReferenceNames),
    );
  addNames(names, collectScopedReferenceNames(node.body, loopScope, eventHandlerReferenceNames));
  return names;
};

const collectForInOrOfStatementReferenceNames = (
  node: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  if (!isNodeOfType(node, "ForInStatement") && !isNodeOfType(node, "ForOfStatement"))
    return new Set();
  const names = new Set<string>();
  const loopScope = createBlockBindingScope(scope);
  addNames(names, collectScopedReferenceNames(node.right, loopScope, eventHandlerReferenceNames));
  if (isNodeOfType(node.left, "VariableDeclaration")) {
    const declarationScope = getVariableDeclarationScope(node.left, loopScope);
    for (const declarator of node.left.declarations ?? []) {
      addPatternBindings(declarator.id, declarationScope);
    }
  } else {
    addPatternBindings(node.left, loopScope);
  }
  addNames(names, collectScopedReferenceNames(node.body, loopScope, eventHandlerReferenceNames));
  return names;
};

const collectCatchClauseReferenceNames = (
  node: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  if (!isNodeOfType(node, "CatchClause")) return new Set();
  const catchScope = createBlockBindingScope(scope);
  addPatternBindings(node.param, catchScope);
  return collectScopedReferenceNames(node.body, catchScope, eventHandlerReferenceNames);
};

const collectJsxAttributeReferenceNames = (
  node: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  if (!isNodeOfType(node, "JSXAttribute")) return new Set();
  const attributeName = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : null;
  if (!node.value) return new Set();
  if (attributeName && isEventHandlerName(attributeName) && isIntrinsicJsxAttribute(node))
    return new Set();
  if (
    attributeName &&
    isEventHandlerName(attributeName) &&
    isNodeOfType(node.value, "JSXExpressionContainer") &&
    isEventHandlerValue(node.value.expression, eventHandlerReferenceNames, (name) =>
      resolveBindingName(scope, name),
    )
  ) {
    return new Set();
  }
  return collectScopedReferenceNames(node.value, scope, eventHandlerReferenceNames);
};

export const collectScopedReferenceNames = (
  node: EsTreeNode,
  scope: BindingScope,
  eventHandlerReferenceNames: Set<string>,
): Set<string> => {
  if (isNodeOfType(node, "Identifier")) return new Set([resolveBindingName(scope, node.name)]);
  if (
    isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression")
  ) {
    return collectFunctionReferenceNames(node, scope, eventHandlerReferenceNames);
  }
  if (isNodeOfType(node, "BlockStatement")) {
    return collectBlockStatementReferenceNames(node, scope, eventHandlerReferenceNames);
  }
  if (isNodeOfType(node, "VariableDeclaration")) {
    return collectVariableDeclarationReferenceNames(node, scope, eventHandlerReferenceNames);
  }
  if (isNodeOfType(node, "Property")) {
    return collectPropertyReferenceNames(node, scope, eventHandlerReferenceNames);
  }
  if (isNodeOfType(node, "MemberExpression")) {
    return collectMemberExpressionReferenceNames(node, scope, eventHandlerReferenceNames);
  }
  if (isNodeOfType(node, "ForStatement")) {
    return collectForStatementReferenceNames(node, scope, eventHandlerReferenceNames);
  }
  if (isNodeOfType(node, "ForInStatement") || isNodeOfType(node, "ForOfStatement")) {
    return collectForInOrOfStatementReferenceNames(node, scope, eventHandlerReferenceNames);
  }
  if (isNodeOfType(node, "CatchClause")) {
    return collectCatchClauseReferenceNames(node, scope, eventHandlerReferenceNames);
  }
  if (isNodeOfType(node, "JSXAttribute")) {
    return collectJsxAttributeReferenceNames(node, scope, eventHandlerReferenceNames);
  }
  return collectChildrenReferenceNames(node, scope, eventHandlerReferenceNames);
};
