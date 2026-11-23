import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../utils/rule-context.js";

const readCurrentMember = (node: EsTreeNode, binding: SymbolDescriptor, context: RuleContext) =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.object, "Identifier") &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "current" &&
  context.scopes.symbolFor(node.object) === binding;

const readBindingFromCurrent = (node: EsTreeNode, context: RuleContext) =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.object, "Identifier") &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "current" &&
  context.scopes.symbolFor(node.object);

const readRefInitializer = (binding: SymbolDescriptor, owner: EsTreeNode, context: RuleContext) => {
  const initializer = binding.initializer;
  return binding.kind === "const" &&
    isFunctionLike(owner) &&
    binding.declarationNode.parent?.parent === owner.body &&
    initializer &&
    isNodeOfType(initializer, "CallExpression") &&
    !initializer.optional &&
    initializer.arguments.length === 1 &&
    isReactApiCall(initializer, "useRef", context.scopes) &&
    hasCompleteSymbolReferences(binding, owner, context.scopes)
    ? initializer.arguments[0]
    : null;
};

const readBindingWrites = (
  binding: SymbolDescriptor,
  context: RuleContext,
): Set<EsTreeNode> | null => {
  const writes = new Set<EsTreeNode>();
  for (const reference of binding.references) {
    const member = reference.identifier.parent;
    if (reference.flag !== "read" || !member || !readCurrentMember(member, binding, context)) {
      return null;
    }
    if (isWithinAssignmentTarget(member)) writes.add(member);
  }
  return writes;
};

const readAssignment = (statement: EsTreeNode, binding: SymbolDescriptor, context: RuleContext) => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const assignment = statement.expression;
  return isNodeOfType(assignment, "AssignmentExpression") &&
    assignment.operator === "=" &&
    readCurrentMember(assignment.left, binding, context)
    ? assignment
    : null;
};

const readUnitIncrement = (
  statement: EsTreeNode,
  binding: SymbolDescriptor,
  context: RuleContext,
) => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const increment = statement.expression;
  return isNodeOfType(increment, "AssignmentExpression") &&
    increment.operator === "+=" &&
    isNodeOfType(increment.right, "Literal") &&
    increment.right.value === 1 &&
    readCurrentMember(increment.left, binding, context)
    ? increment.left
    : null;
};

interface CommittedMirrorInput {
  readonly owner:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionDeclaration">;
  readonly openRead: EsTreeNode;
  readonly expectedOpen: SymbolDescriptor;
  readonly generationUpdate: EsTreeNodeOfType<"UpdateExpression">;
  readonly earlierRequestEffect: EsTreeNode;
  readonly context: RuleContext;
}

// A passive setup follows the committed Boolean, and its only other write is
// the corresponding cleanup. Both close-time invalidations advance the same
// request generation. The caller checks producer identity and the paired
// open/request effects before using this witness.
export const hasClosedCommittedLoadingMirror = ({
  owner,
  openRead,
  expectedOpen,
  generationUpdate,
  earlierRequestEffect,
  context,
}: CommittedMirrorInput): boolean => {
  if (!isNodeOfType(owner.body, "BlockStatement")) return false;
  const openRef = readBindingFromCurrent(openRead, context);
  const generation = readBindingFromCurrent(generationUpdate.argument, context);
  if (!openRef || !generation || openRef === generation) return false;
  const initialOpen = readRefInitializer(openRef, owner, context);
  const initialGeneration = readRefInitializer(generation, owner, context);
  const open = initialOpen && context.scopes.symbolFor(initialOpen);
  if (
    !open ||
    open !== expectedOpen ||
    open.kind !== "parameter" ||
    open.scope.node !== owner ||
    !open.references.every(
      ({ flag, identifier }) => flag === "read" && !isWithinAssignmentTarget(identifier),
    ) ||
    !isNodeOfType(initialGeneration, "Literal") ||
    initialGeneration.value !== 0 ||
    generationUpdate.operator !== "++" ||
    !generationUpdate.prefix
  ) {
    return false;
  }
  const openWrites = readBindingWrites(openRef, context);
  const generationWrites = readBindingWrites(generation, context);
  if (!openWrites || !generationWrites || openWrites.size !== 2 || generationWrites.size !== 3) {
    return false;
  }

  const end = owner.body.body.findIndex((statement) => statement === earlierRequestEffect);
  if (end < 1) return false;
  return owner.body.body.slice(0, end).some((statement) => {
    if (!isNodeOfType(statement, "ExpressionStatement")) return false;
    const call = statement.expression;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments.length !== 2 ||
      !isReactApiCall(call, "useEffect", context.scopes)
    ) {
      return false;
    }
    const [setup, dependencies] = call.arguments;
    if (
      !isNodeOfType(setup, "ArrowFunctionExpression") ||
      setup.async ||
      setup.params.length !== 0 ||
      !isNodeOfType(setup.body, "BlockStatement") ||
      setup.body.body.length !== 3 ||
      !isNodeOfType(dependencies, "ArrayExpression") ||
      dependencies.elements.length !== 1 ||
      !isNodeOfType(dependencies.elements[0], "Identifier") ||
      context.scopes.symbolFor(dependencies.elements[0]) !== open
    ) {
      return false;
    }
    const [synchronize, invalidate, finish] = setup.body.body;
    const assignment = readAssignment(synchronize, openRef, context);
    if (
      !assignment ||
      !isNodeOfType(assignment.right, "Identifier") ||
      context.scopes.symbolFor(assignment.right) !== open ||
      !isNodeOfType(invalidate, "IfStatement") ||
      invalidate.alternate ||
      !isNodeOfType(invalidate.test, "UnaryExpression") ||
      invalidate.test.operator !== "!" ||
      !isNodeOfType(invalidate.test.argument, "Identifier") ||
      context.scopes.symbolFor(invalidate.test.argument) !== open ||
      !isNodeOfType(invalidate.consequent, "BlockStatement") ||
      invalidate.consequent.body.length !== 1 ||
      !isNodeOfType(finish, "ReturnStatement") ||
      !isNodeOfType(finish.argument, "ArrowFunctionExpression") ||
      finish.argument.async ||
      finish.argument.params.length !== 0 ||
      !isNodeOfType(finish.argument.body, "BlockStatement") ||
      finish.argument.body.body.length !== 2
    ) {
      return false;
    }
    const [inactivate, release] = finish.argument.body.body;
    const cleanup = readAssignment(inactivate, openRef, context);
    const onClose = readUnitIncrement(invalidate.consequent.body[0], generation, context);
    const onRelease = readUnitIncrement(release, generation, context);
    return Boolean(
      cleanup &&
      isNodeOfType(cleanup.right, "Literal") &&
      cleanup.right.value === false &&
      openWrites.has(assignment.left) &&
      openWrites.has(cleanup.left) &&
      onClose &&
      generationWrites.has(onClose) &&
      onRelease &&
      generationWrites.has(onRelease) &&
      generationWrites.has(generationUpdate.argument),
    );
  });
};

interface ResetFirstGenerationInput {
  readonly owner: EsTreeNode;
  readonly request: EsTreeNode;
  readonly token: SymbolDescriptor;
  readonly update: EsTreeNodeOfType<"UpdateExpression">;
  readonly resetStatement: EsTreeNode;
  readonly context: RuleContext;
}

export const hasClosedResetFirstGeneration = ({
  owner,
  request,
  token,
  update,
  resetStatement,
  context,
}: ResetFirstGenerationInput): boolean => {
  const generation = readBindingFromCurrent(update.argument, context);
  if (!generation || !hasCompleteSymbolReferences(token, request, context.scopes)) return false;
  const initial = readRefInitializer(generation, owner, context);
  const invalidation = readUnitIncrement(resetStatement, generation, context);
  if (
    !isNodeOfType(initial, "Literal") ||
    initial.value !== 0 ||
    !invalidation ||
    !token.references.every(
      ({ flag, identifier }) => flag === "read" && !isWithinAssignmentTarget(identifier),
    )
  ) {
    return false;
  }

  const writes = readBindingWrites(generation, context);
  if (!writes || writes.size !== 2 || !writes.has(invalidation) || !writes.has(update.argument)) {
    return false;
  }
  return generation.references.every(({ identifier }) => {
    const member = identifier.parent;
    if (!member) return false;
    if (writes.has(member)) return true;
    const comparison = member.parent;
    if (
      !isNodeOfType(comparison, "BinaryExpression") ||
      (comparison.operator !== "===" && comparison.operator !== "!==") ||
      findEnclosingFunction(comparison) !== request
    ) {
      return false;
    }
    const other = comparison.left === member ? comparison.right : comparison.left;
    return isNodeOfType(other, "Identifier") && context.scopes.symbolFor(other) === token;
  });
};

export const hasClosedLoadingGenerationCleanup = (
  owner: EsTreeNode,
  capture: EsTreeNodeOfType<"UpdateExpression">,
  cleanup: EsTreeNode,
  context: RuleContext,
): boolean => {
  const generation = readBindingFromCurrent(capture.argument, context);
  if (!generation || capture.operator !== "++" || !capture.prefix) return false;
  const initial = readRefInitializer(generation, owner, context);
  if (!isNodeOfType(initial, "Literal") || initial.value !== 0) return false;
  const release = readUnitIncrement(cleanup, generation, context);
  const writers = readBindingWrites(generation, context);
  return Boolean(
    release && writers?.size === 2 && writers.has(capture.argument) && writers.has(release),
  );
};
