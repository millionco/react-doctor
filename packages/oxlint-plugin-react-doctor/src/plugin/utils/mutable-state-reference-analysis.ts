import { MUTATING_ARRAY_METHODS, MUTATING_COLLECTION_METHODS } from "../constants/js.js";
import { OBJECT_PROPERTY_MUTATION_METHOD_NAMES } from "../constants/mutation-methods.js";
import { collectPatternNames } from "./collect-pattern-names.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isResultDiscardedCall } from "./is-result-discarded-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const REFLECT_MUTATION_METHODS = new Set(["deleteProperty", "set"]);

export interface MutableStateReferenceState {
  isAdditionalMutableStateSource?: (expression: EsTreeNode) => boolean;
  mutableStateSourceNames: Set<string>;
}

export interface MutableStateReferenceMutation {
  node: EsTreeNode;
  receiver: EsTreeNode;
}

export interface CollectMutableStateReferenceMutationsOptions {
  isAdditionalMutatingCall?: (callExpression: EsTreeNodeOfType<"CallExpression">) => boolean;
  isProvenMutatingMethodCall?: (callExpression: EsTreeNodeOfType<"CallExpression">) => boolean;
}

const isStaticMethodCallOnNamedObject = (
  node: EsTreeNodeOfType<"CallExpression">,
  objectName: string,
  methodNames: ReadonlySet<string>,
): boolean => {
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const calleeObject = stripParenExpression(callee.object);
  if (!isNodeOfType(calleeObject, "Identifier") || calleeObject.name !== objectName) return false;
  const methodName = getStaticPropertyName(callee);
  if (!methodName || !methodNames.has(methodName)) return false;
  return !findVariableInitializer(calleeObject, calleeObject.name);
};

export const isExpressionRootedInMutableStateSource = (
  node: EsTreeNode,
  state: MutableStateReferenceState,
): boolean => {
  let current: EsTreeNode | null | undefined = stripParenExpression(node);
  while (current && isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return (
    (isNodeOfType(current, "Identifier") && state.mutableStateSourceNames.has(current.name)) ||
    Boolean(current && state.isAdditionalMutableStateSource?.(current))
  );
};

export const isExpressionReachableFromMutableState = (
  node: EsTreeNode | null | undefined,
  state: MutableStateReferenceState,
): boolean => {
  if (!node) return false;
  const expression = stripParenExpression(node);
  return (
    (isNodeOfType(expression, "Identifier") &&
      state.mutableStateSourceNames.has(expression.name)) ||
    (isNodeOfType(expression, "MemberExpression") &&
      isExpressionRootedInMutableStateSource(expression, state)) ||
    Boolean(state.isAdditionalMutableStateSource?.(expression))
  );
};

export const addMutableStateReferenceBindings = (
  pattern: EsTreeNode,
  state: MutableStateReferenceState,
): void => {
  if (isNodeOfType(pattern, "Identifier")) {
    state.mutableStateSourceNames.add(pattern.name);
    return;
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties) {
      if (!isNodeOfType(property, "Property")) continue;
      const value = property.value;
      if (isNodeOfType(value, "Identifier")) {
        state.mutableStateSourceNames.add(value.name);
      } else if (
        isNodeOfType(value, "AssignmentPattern") &&
        isNodeOfType(value.left, "Identifier")
      ) {
        state.mutableStateSourceNames.add(value.left.name);
      }
    }
    return;
  }
  if (!isNodeOfType(pattern, "ArrayPattern")) return;
  for (const element of pattern.elements) {
    if (isNodeOfType(element, "Identifier")) {
      state.mutableStateSourceNames.add(element.name);
    } else if (
      isNodeOfType(element, "AssignmentPattern") &&
      isNodeOfType(element.left, "Identifier")
    ) {
      state.mutableStateSourceNames.add(element.left.name);
    }
  }
};

export const updateMutableStateReferencesForVariableDeclaration = (
  declaration: EsTreeNodeOfType<"VariableDeclaration">,
  state: MutableStateReferenceState,
): void => {
  for (const declarator of declaration.declarations) {
    const bindingNames = new Set<string>();
    collectPatternNames(declarator.id, bindingNames);
    for (const bindingName of bindingNames) state.mutableStateSourceNames.delete(bindingName);
    if (!isExpressionReachableFromMutableState(declarator.init, state)) continue;
    if (isNodeOfType(declarator.id, "Identifier")) {
      state.mutableStateSourceNames.add(declarator.id.name);
    } else {
      addMutableStateReferenceBindings(declarator.id, state);
    }
  }
};

export const updateMutableStateReferencesForIdentifierAssignment = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  state: MutableStateReferenceState,
): void => {
  if (!isNodeOfType(assignment.left, "Identifier")) return;
  state.mutableStateSourceNames.delete(assignment.left.name);
  if (isExpressionReachableFromMutableState(assignment.right, state)) {
    state.mutableStateSourceNames.add(assignment.left.name);
  }
};

export const collectMutableStateReferenceMutations = (
  node: EsTreeNode,
  state: MutableStateReferenceState,
  options: CollectMutableStateReferenceMutationsOptions = {},
): MutableStateReferenceMutation[] => {
  if (isFunctionLike(node)) return [];
  const mutations: MutableStateReferenceMutation[] = [];
  walkAst(node, (child: EsTreeNode) => {
    const candidate = stripParenExpression(child);
    if (child !== node && isFunctionLike(candidate)) return false;
    if (isNodeOfType(candidate, "AssignmentExpression")) {
      const assignmentTarget = stripParenExpression(candidate.left);
      if (
        isNodeOfType(assignmentTarget, "MemberExpression") &&
        isExpressionRootedInMutableStateSource(candidate.left, state)
      ) {
        mutations.push({ node: candidate, receiver: assignmentTarget.object });
      }
      return;
    }
    if (isNodeOfType(candidate, "UpdateExpression")) {
      const updateTarget = stripParenExpression(candidate.argument);
      if (
        isNodeOfType(updateTarget, "MemberExpression") &&
        isExpressionRootedInMutableStateSource(candidate.argument, state)
      ) {
        mutations.push({ node: candidate, receiver: updateTarget.object });
      }
      return;
    }
    if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "delete") {
      const deleteTarget = stripParenExpression(candidate.argument);
      if (
        isNodeOfType(deleteTarget, "MemberExpression") &&
        isExpressionRootedInMutableStateSource(candidate.argument, state)
      ) {
        mutations.push({ node: candidate, receiver: deleteTarget.object });
      }
      return;
    }
    if (!isNodeOfType(candidate, "CallExpression")) return;
    const firstArgument = candidate.arguments[0];
    if (
      firstArgument &&
      !isNodeOfType(firstArgument, "SpreadElement") &&
      isExpressionRootedInMutableStateSource(firstArgument, state) &&
      (isStaticMethodCallOnNamedObject(
        candidate,
        "Object",
        OBJECT_PROPERTY_MUTATION_METHOD_NAMES,
      ) ||
        isStaticMethodCallOnNamedObject(candidate, "Reflect", REFLECT_MUTATION_METHODS) ||
        options.isAdditionalMutatingCall?.(candidate))
    ) {
      mutations.push({ node: candidate, receiver: firstArgument });
      return;
    }
    const callee = stripParenExpression(candidate.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    const methodName = getStaticPropertyName(callee);
    if (!methodName || !isExpressionRootedInMutableStateSource(callee.object, state)) return;
    if (options.isProvenMutatingMethodCall) {
      if (!options.isProvenMutatingMethodCall(candidate)) return;
    } else {
      if (!MUTATING_ARRAY_METHODS.has(methodName) && !MUTATING_COLLECTION_METHODS.has(methodName)) {
        return;
      }
      if (
        MUTATING_COLLECTION_METHODS.has(methodName) &&
        !MUTATING_ARRAY_METHODS.has(methodName) &&
        !isResultDiscardedCall(candidate)
      ) {
        return;
      }
    }
    mutations.push({ node: candidate, receiver: callee.object });
  });
  return mutations;
};
