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

interface ClosedLoadingGenerationInput {
  readonly owner: EsTreeNode;
  readonly request: EsTreeNode;
  readonly token: SymbolDescriptor;
  readonly update: EsTreeNodeOfType<"UpdateExpression">;
  readonly resetStatement?: EsTreeNode;
  readonly context: RuleContext;
}

export const hasClosedLoadingGeneration = ({
  owner,
  request,
  token,
  update,
  resetStatement,
  context,
}: ClosedLoadingGenerationInput): boolean => {
  const generation = readBindingFromCurrent(update.argument, context);
  if (!generation || !hasCompleteSymbolReferences(token, request, context.scopes)) return false;
  const initial = readRefInitializer(generation, owner, context);
  const invalidation = resetStatement && readUnitIncrement(resetStatement, generation, context);
  if (
    !isNodeOfType(initial, "Literal") ||
    initial.value !== 0 ||
    (resetStatement && !invalidation) ||
    !token.references.every(
      ({ flag, identifier }) => flag === "read" && !isWithinAssignmentTarget(identifier),
    )
  ) {
    return false;
  }

  const writes = readBindingWrites(generation, context);
  if (
    !writes ||
    writes.size !== (invalidation ? 2 : 1) ||
    (invalidation && !writes.has(invalidation)) ||
    !writes.has(update.argument)
  ) {
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

type OwnerBody = EsTreeNodeOfType<"BlockStatement">;
type MirrorPhase = "useEffect" | "useLayoutEffect";

const readOwnerEffect = (
  statement: EsTreeNode,
  api: MirrorPhase,
  context: RuleContext,
  allowEveryCommit = false,
) => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const call = statement.expression;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    (call.arguments.length !== 2 && !(allowEveryCommit && call.arguments.length === 1)) ||
    !isReactApiCall(call, api, context.scopes)
  )
    return null;
  const [effect, deps] = call.arguments;
  const dependencies = isNodeOfType(deps, "ArrayExpression")
    ? deps.elements
    : allowEveryCommit && !deps
      ? []
      : null;
  return isNodeOfType(effect, "ArrowFunctionExpression") &&
    !effect.async &&
    effect.params.length === 0 &&
    isNodeOfType(effect.body, "BlockStatement") &&
    dependencies
    ? { body: effect.body, dependencies, everyCommit: !deps }
    : null;
};

const hasDependency = (
  dependencies: readonly (EsTreeNode | null)[],
  binding: SymbolDescriptor,
  context: RuleContext,
) =>
  dependencies.some(
    (item) => isNodeOfType(item, "Identifier") && context.scopes.symbolFor(item) === binding,
  );

const readCommittedMirrorSetup = (
  body: OwnerBody,
  index: number,
  phase: MirrorPhase,
  property: SymbolDescriptor,
  member: EsTreeNode,
  context: RuleContext,
  layoutEveryCommit = false,
) => {
  const ref = readBindingFromCurrent(member, context);
  const owner = body.parent;
  if (!ref || !isFunctionLike(owner)) return null;
  const initial = readRefInitializer(ref, owner, context);
  if (!isNodeOfType(initial, "Identifier") || context.scopes.symbolFor(initial) !== property) {
    return null;
  }
  const writes = readBindingWrites(ref, context);
  if (!writes) return null;
  for (const statement of body.body.slice(0, index)) {
    const effect = readOwnerEffect(statement, phase, context, layoutEveryCommit);
    if (
      !effect ||
      (layoutEveryCommit
        ? !effect.everyCommit
        : !hasDependency(effect.dependencies, property, context))
    )
      continue;
    const assignments = effect.body.body.map((item) => {
      if (
        !isNodeOfType(item, "ExpressionStatement") ||
        !isNodeOfType(item.expression, "AssignmentExpression") ||
        !isNodeOfType(item.expression.right, "Identifier")
      )
        return null;
      const receiver = readBindingFromCurrent(item.expression.left, context);
      const source = context.scopes.symbolFor(item.expression.right);
      return receiver &&
        source &&
        readRefInitializer(receiver, owner, context) &&
        readBindingWrites(receiver, context)
        ? readAssignment(item, receiver, context)
        : null;
    });
    if (assignments.some((item) => item === null)) continue;
    const assignment = assignments.find(
      (item) => item && context.scopes.symbolFor(item.right) === property && writes.has(item.left),
    );
    if (assignment) return { ref, setup: statement, assignment, writes };
  }
  return null;
};

const readScalarRelease = (
  body: OwnerBody,
  stableCleanup: SymbolDescriptor,
  context: RuleContext,
) => {
  for (const statement of body.body) {
    const effect = readOwnerEffect(statement, "useEffect", context);
    if (
      !effect ||
      effect.dependencies.length !== 1 ||
      !hasDependency(effect.dependencies, stableCleanup, context) ||
      effect.body.body.length !== 1
    )
      continue;
    const returned = effect.body.body[0];
    if (
      !isNodeOfType(returned, "ReturnStatement") ||
      !isNodeOfType(returned.argument, "ArrowFunctionExpression") ||
      returned.argument.async ||
      returned.argument.params.length !== 0 ||
      !isNodeOfType(returned.argument.body, "BlockStatement") ||
      returned.argument.body.body.length !== 2
    )
      continue;
    const [release, cleanup] = returned.argument.body.body;
    if (!isNodeOfType(cleanup, "ExpressionStatement")) continue;
    const call = cleanup.expression;
    if (
      isNodeOfType(call, "CallExpression") &&
      !call.optional &&
      call.arguments.length === 0 &&
      isNodeOfType(call.callee, "Identifier") &&
      context.scopes.symbolFor(call.callee) === stableCleanup
    )
      return release;
  }
  return null;
};

const hasClosedMountedFlag = (
  body: OwnerBody,
  beforeLaunch: number,
  member: EsTreeNode,
  context: RuleContext,
): boolean => {
  const owner = body.parent;
  const ref = readBindingFromCurrent(member, context);
  if (!ref || !isFunctionLike(owner)) return false;
  const initial = readRefInitializer(ref, owner, context);
  const writes = readBindingWrites(ref, context);
  if (!isNodeOfType(initial, "Literal") || initial.value !== true || writes?.size !== 2)
    return false;

  return body.body.slice(0, beforeLaunch).some((statement) => {
    const effect = readOwnerEffect(statement, "useEffect", context);
    if (!effect || effect.dependencies.length !== 0 || effect.body.body.length !== 2) {
      return false;
    }
    const [start, cleanup] = effect.body.body;
    const commit = readAssignment(start, ref, context);
    if (
      !commit ||
      !isNodeOfType(commit.right, "Literal") ||
      commit.right.value !== true ||
      !writes.has(commit.left) ||
      !isNodeOfType(cleanup, "ReturnStatement") ||
      !isNodeOfType(cleanup.argument, "ArrowFunctionExpression") ||
      cleanup.argument.async ||
      cleanup.argument.params.length !== 0 ||
      !isNodeOfType(cleanup.argument.body, "BlockStatement") ||
      cleanup.argument.body.body.length !== 1
    )
      return false;
    const release = readAssignment(cleanup.argument.body.body[0], ref, context);
    return Boolean(
      release &&
      writes.has(release.left) &&
      isNodeOfType(release.right, "Literal") &&
      release.right.value === false,
    );
  });
};

interface ViewMirrorInput {
  readonly owner: EsTreeNode;
  readonly requestEffect: EsTreeNode;
  readonly expectedView: SymbolDescriptor;
  readonly expectedOpen: SymbolDescriptor;
  readonly stableCleanup: SymbolDescriptor;
  readonly viewRead: EsTreeNode;
  readonly context: RuleContext;
}

type CommittedViewGuard =
  | {
      readonly openRead: EsTreeNode;
      readonly mountedRead?: EsTreeNode;
      readonly generationUpdate?: never;
    }
  | {
      readonly openRead?: never;
      readonly mountedRead?: never;
      readonly generationUpdate: EsTreeNodeOfType<"UpdateExpression">;
      readonly generationRead: EsTreeNode;
    };

// Select one exact commit-time view release. All writes to the scalar refs
// must be either the proven setup, the selected request, or its paired teardown.
export const hasClosedDismissiveViewMirrors = ({
  owner,
  requestEffect,
  expectedView,
  expectedOpen,
  stableCleanup,
  viewRead,
  openRead,
  mountedRead,
  generationUpdate,
  context,
  ...guard
}: ViewMirrorInput & CommittedViewGuard): boolean => {
  if (!isFunctionLike(owner) || !isNodeOfType(owner.body, "BlockStatement")) return false;
  const body = owner.body;
  const index = body.body.findIndex((statement) => statement === requestEffect);
  if (index < 1) return false;
  const phase = generationUpdate || mountedRead ? "useLayoutEffect" : "useEffect";
  const view = readCommittedMirrorSetup(
    body,
    index,
    phase,
    expectedView,
    viewRead,
    context,
    Boolean(mountedRead),
  );
  if (!view || view.writes.size !== 1) return false;
  if (mountedRead && openRead) {
    const open = readCommittedMirrorSetup(
      body,
      index,
      phase,
      expectedOpen,
      openRead,
      context,
      true,
    );
    return Boolean(
      open &&
      open.ref !== view.ref &&
      open.setup === view.setup &&
      open.writes.size === 1 &&
      hasClosedMountedFlag(body, index, mountedRead, context),
    );
  }
  const release = readScalarRelease(body, stableCleanup, context);
  if (!release) return false;
  if (!generationUpdate) {
    if (!openRead) return false;
    const open = readCommittedMirrorSetup(body, index, phase, expectedOpen, openRead, context);
    const cleanup = open && readAssignment(release, open.ref, context);
    return Boolean(
      open &&
      open.ref !== view.ref &&
      open.setup === view.setup &&
      open.writes.size === 2 &&
      cleanup &&
      open.writes.has(cleanup.left) &&
      isNodeOfType(cleanup.right, "Literal") &&
      cleanup.right.value === false,
    );
  }

  if (!("generationRead" in guard)) return false;
  const generation = readBindingFromCurrent(generationUpdate.argument, context);
  if (
    !generation ||
    generation === view.ref ||
    readBindingFromCurrent(guard.generationRead, context) !== generation ||
    generationUpdate.operator !== "++" ||
    !generationUpdate.prefix
  )
    return false;
  const initial = readRefInitializer(generation, owner, context);
  const writes = readBindingWrites(generation, context);
  const cleanup = readUnitIncrement(release, generation, context);
  if (
    !isNodeOfType(initial, "Literal") ||
    initial.value !== 0 ||
    !cleanup ||
    writes?.size !== 3 ||
    !writes.has(cleanup) ||
    !writes.has(generationUpdate.argument)
  )
    return false;
  return body.body.slice(0, index).some((statement) => {
    const setup = readOwnerEffect(statement, "useLayoutEffect", context);
    if (
      !setup ||
      setup.body.body.length !== 1 ||
      setup.dependencies.length !== 2 ||
      !hasDependency(setup.dependencies, expectedOpen, context) ||
      !hasDependency(setup.dependencies, expectedView, context)
    )
      return false;
    const invalidation = readUnitIncrement(setup.body.body[0], generation, context);
    return invalidation !== null && writes.has(invalidation);
  });
};
