import type { Reference, Variable } from "eslint-scope";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { getUseStateDecl } from "./effect/react.js";

const isEventAttribute = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "JSXAttribute") &&
  isNodeOfType(node.name, "JSXIdentifier") &&
  /^on[A-Z]/.test(node.name.name);

const isEventProperty = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Property") &&
  !node.computed &&
  isNodeOfType(node.key, "Identifier") &&
  /^on[A-Z]/.test(node.key.name);

const findVariableForDefinition = (
  analysis: ProgramAnalysis,
  definitionNode: EsTreeNode,
): Variable | null => {
  for (const scope of analysis.scopeManager.scopes) {
    const variable = scope.variables.find((candidate) =>
      candidate.defs.some(
        (definition) => (definition.node as unknown as EsTreeNode) === definitionNode,
      ),
    );
    if (variable) return variable;
  }
  return null;
};

const findFunctionDefinitionNode = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration")) return functionNode;
  let current: EsTreeNode | null | undefined = functionNode;
  while (current) {
    if (isNodeOfType(current, "VariableDeclarator")) return current;
    if (isNodeOfType(current, "Program") || (isFunctionLike(current) && current !== functionNode)) {
      return null;
    }
    current = current.parent;
  }
  return null;
};

const isInsideInlineEventHandler = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current && current !== boundary) {
    if (isEventAttribute(current) || isEventProperty(current)) return true;
    current = current.parent;
  }
  return false;
};

const isFunctionWiredToEventAttribute = (
  analysis: ProgramAnalysis,
  functionNode: EsTreeNode,
): boolean => {
  const definitionNode = findFunctionDefinitionNode(functionNode);
  if (!definitionNode) return false;
  const variable = findVariableForDefinition(analysis, definitionNode);
  if (!variable) return false;
  return variable.references.some((reference) => {
    let current: EsTreeNode | null | undefined = reference.identifier as unknown as EsTreeNode;
    while (current && !isFunctionLike(current)) {
      if (isEventAttribute(current) || isEventProperty(current)) return true;
      current = current.parent;
    }
    return false;
  });
};

const isFunctionCalledOnlyFromHandlers = (
  analysis: ProgramAnalysis,
  functionNode: EsTreeNode,
  componentFunction: EsTreeNode,
): boolean => {
  const definitionNode = findFunctionDefinitionNode(functionNode);
  if (!definitionNode) return false;
  const variable = findVariableForDefinition(analysis, definitionNode);
  if (!variable) return false;
  let hasCall = false;
  for (const reference of variable.references) {
    const identifier = reference.identifier as unknown as EsTreeNode;
    const parent = identifier.parent;
    if (!parent || !isNodeOfType(parent, "CallExpression") || parent.callee !== identifier) {
      continue;
    }
    hasCall = true;
    if (!isInsideProvenEventHandler(analysis, parent, componentFunction, false)) return false;
  }
  return hasCall;
};

const isFunctionUsedOutsideHandlers = (
  analysis: ProgramAnalysis,
  functionNode: EsTreeNode,
  componentFunction: EsTreeNode,
): boolean => {
  const definitionNode = findFunctionDefinitionNode(functionNode);
  if (!definitionNode) return true;
  const variable = findVariableForDefinition(analysis, definitionNode);
  if (!variable) return true;
  return variable.references.some((reference) => {
    if (reference.init) return false;
    const identifier = reference.identifier as unknown as EsTreeNode;
    if (isInsideInlineEventHandler(identifier, componentFunction)) return false;
    const parent = identifier.parent;
    if (parent && isNodeOfType(parent, "CallExpression") && parent.callee === identifier) {
      if (findEnclosingFunction(parent) === functionNode) return false;
      if (isInsideProvenEventHandler(analysis, parent, componentFunction, false)) return false;
    }
    return true;
  });
};

const isInsideProvenEventHandler = (
  analysis: ProgramAnalysis,
  node: EsTreeNode,
  componentFunction: EsTreeNode,
  allowOneCallFrame: boolean,
): boolean => {
  if (isInsideInlineEventHandler(node, componentFunction)) return true;
  let current: EsTreeNode | null | undefined = node.parent;
  while (current && current !== componentFunction) {
    if (isFunctionLike(current)) {
      if (
        isFunctionWiredToEventAttribute(analysis, current) &&
        !isFunctionUsedOutsideHandlers(analysis, current, componentFunction)
      ) {
        return true;
      }
      return (
        allowOneCallFrame && isFunctionCalledOnlyFromHandlers(analysis, current, componentFunction)
      );
    }
    current = current.parent;
  }
  return false;
};

const isSetterWriterUsage = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "CallExpression")) {
    return parent.callee === identifier || (parent.arguments ?? []).includes(identifier as never);
  }
  let current: EsTreeNode | null | undefined = identifier;
  while (current && !isFunctionLike(current)) {
    if (isEventAttribute(current) || isEventProperty(current)) return true;
    current = current.parent;
  }
  return false;
};

const findSetterVariable = (
  analysis: ProgramAnalysis,
  stateReference: Reference,
): Variable | null => {
  const stateDeclarator = getUseStateDecl(analysis, stateReference);
  if (!stateDeclarator || !isNodeOfType(stateDeclarator, "VariableDeclarator")) return null;
  if (!isNodeOfType(stateDeclarator.id, "ArrayPattern")) return null;
  const setter = stateDeclarator.id.elements?.[1];
  if (!setter || !isNodeOfType(setter, "Identifier")) return null;
  for (const scope of analysis.scopeManager.scopes) {
    const variable = scope.variables.find(
      (candidate) =>
        candidate.name === setter.name &&
        candidate.defs.some(
          (definition) => (definition.node as unknown as EsTreeNode) === stateDeclarator,
        ),
    );
    if (variable) return variable;
  }
  return null;
};

export const isStateWrittenOnlyFromEventHandlers = (
  analysis: ProgramAnalysis,
  stateReference: Reference,
): boolean => {
  const setterVariable = findSetterVariable(analysis, stateReference);
  if (!setterVariable) return false;
  const stateDeclarator = getUseStateDecl(analysis, stateReference);
  if (!stateDeclarator) return false;
  const componentFunction = findEnclosingFunction(stateDeclarator);
  if (!componentFunction) return false;
  let hasWriter = false;
  for (const reference of setterVariable.references) {
    const identifier = reference.identifier as unknown as EsTreeNode;
    if (!isSetterWriterUsage(identifier)) continue;
    hasWriter = true;
    const inside = isInsideProvenEventHandler(analysis, identifier, componentFunction, true);
    if (!inside) return false;
  }
  return hasWriter;
};
