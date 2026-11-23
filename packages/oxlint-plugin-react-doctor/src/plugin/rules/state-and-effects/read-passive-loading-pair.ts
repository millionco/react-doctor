import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";

type PassiveResetMode =
  | "after-request"
  | "before-request"
  | "after-request-with-cleanup"
  | "within-request";

interface RenderLoadingPairInput {
  readonly owner: EsTreeNode;
  readonly request: EsTreeNode;
  readonly extraSetterIdentifier: EsTreeNode;
  readonly firstAwait: EsTreeNodeOfType<"AwaitExpression">;
  readonly context: RuleContext;
}

interface PassiveLoadingPairInput extends RenderLoadingPairInput {
  readonly resetMode?: PassiveResetMode;
}

export interface MountedLoadingScope {
  readonly viewProperty: string;
  readonly openProperty: string;
  readonly openBinding: SymbolDescriptor;
  readonly viewBinding: SymbolDescriptor;
  readonly getterBinding: SymbolDescriptor;
  readonly contextHookCall: EsTreeNodeOfType<"CallExpression">;
  readonly contextField: string;
  readonly dismissalProperty?: string;
}

interface PassiveLoadingPair extends MountedLoadingScope {
  readonly requestEffect: EsTreeNode;
  readonly requestCleanup: EsTreeNode | null;
  readonly resetBody: EsTreeNodeOfType<"BlockStatement">;
  readonly stableReset: NonNullable<ReturnType<typeof readStableCallback>>;
  readonly releaseInLaunch?: true;
}

interface RenderLoadingPair extends MountedLoadingScope {
  readonly adjustment: EsTreeNodeOfType<"IfStatement">;
}

interface LoadingPairInput extends RenderLoadingPairInput {
  readonly resetMode?: PassiveResetMode | "render-adjustment";
}

const hasReadonlyReferences = (binding: SymbolDescriptor): boolean =>
  binding.references.every(
    ({ flag, identifier }) => flag === "read" && !isWithinAssignmentTarget(identifier),
  );

const usesDependency = (
  expressions: readonly (EsTreeNode | null)[],
  binding: SymbolDescriptor,
  context: RuleContext,
): boolean =>
  expressions.some(
    (expression) =>
      isNodeOfType(expression, "Identifier") && context.scopes.symbolFor(expression) === binding,
  );

const readPlainPropertyBinding = (
  pattern: EsTreeNode,
  binding: SymbolDescriptor,
): string | null => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  for (const property of pattern.properties) {
    if (
      isNodeOfType(property, "Property") &&
      !property.computed &&
      isNodeOfType(property.key, "Identifier") &&
      property.value === binding.bindingIdentifier
    ) {
      return property.key.name;
    }
  }
  return null;
};

const readCallback = (call: EsTreeNode, api: "useEffect" | "useCallback", context: RuleContext) => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 2 ||
    !isReactApiCall(call, api, context.scopes)
  ) {
    return null;
  }
  const [callback, dependencies] = call.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.params.length !== 0 ||
    !isNodeOfType(dependencies, "ArrayExpression")
  ) {
    return null;
  }
  return { callback, dependencies: dependencies.elements };
};

interface StableResetCallback {
  readonly binding: SymbolDescriptor;
  readonly callback: EsTreeNodeOfType<"ArrowFunctionExpression">;
}

const readStableCallback = (
  dependency: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): StableResetCallback | null => {
  if (!isNodeOfType(dependency, "Identifier")) return null;
  const binding = context.scopes.symbolFor(dependency);
  const declaration = binding?.declarationNode;
  if (
    binding?.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== binding.bindingIdentifier ||
    !declaration.init ||
    !hasCompleteSymbolReferences(binding, owner, context.scopes) ||
    !hasReadonlyReferences(binding)
  ) {
    return null;
  }
  if (!isFunctionLike(owner) || declaration.parent?.parent !== owner.body) return null;
  const hook = readCallback(declaration.init, "useCallback", context);
  return hook && !hook.callback.async && hook.dependencies.length === 0
    ? { binding, callback: hook.callback }
    : null;
};

const readGenerationCleanup = (effect: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  if (!isNodeOfType(effect, "ExpressionStatement")) return null;
  const effectBody = readCallback(effect.expression, "useEffect", context)?.callback.body;
  if (!isNodeOfType(effectBody, "BlockStatement")) return null;
  const returned = effectBody.body[2];
  return isNodeOfType(returned, "ReturnStatement") &&
    isNodeOfType(returned.argument, "ArrowFunctionExpression") &&
    !returned.argument.async &&
    returned.argument.params.length === 0 &&
    isNodeOfType(returned.argument.body, "BlockStatement") &&
    returned.argument.body.body.length === 1
    ? returned.argument.body.body[0]
    : null;
};

const readOpenReset = (
  argument: EsTreeNode,
  getter: SymbolDescriptor,
  requireRequestCleanup: boolean,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (!requireRequestCleanup) {
    return isNodeOfType(argument, "Identifier") ? context.scopes.symbolFor(argument) : null;
  }
  if (
    !isNodeOfType(argument, "CallExpression") ||
    argument.optional ||
    !isNodeOfType(argument.callee, "Identifier") ||
    argument.callee.name !== "Boolean" ||
    !context.scopes.isGlobalReference(argument.callee) ||
    argument.arguments.length !== 1
  ) {
    return null;
  }
  const [operand] = argument.arguments;
  return isNodeOfType(operand, "LogicalExpression") &&
    operand.operator === "&&" &&
    isNodeOfType(operand.left, "Identifier") &&
    isNodeOfType(operand.right, "Identifier") &&
    context.scopes.symbolFor(operand.right) === getter
    ? context.scopes.symbolFor(operand.left)
    : null;
};

const readOpenRequestLaunch = (
  statement: EsTreeNode,
  open: SymbolDescriptor,
  request: SymbolDescriptor,
  context: RuleContext,
  requireRequestCleanup = false,
) => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const effect = readCallback(statement.expression, "useEffect", context);
  if (
    !effect ||
    effect.callback.async ||
    effect.dependencies.length !== 2 ||
    !usesDependency(effect.dependencies, open, context) ||
    !usesDependency(effect.dependencies, request, context) ||
    !isNodeOfType(effect.callback.body, "BlockStatement") ||
    effect.callback.body.body.length !== (requireRequestCleanup ? 3 : 2)
  ) {
    return null;
  }
  const [guard, launch] = effect.callback.body.body;
  return isNodeOfType(guard, "IfStatement") &&
    !guard.alternate &&
    isNodeOfType(guard.test, "UnaryExpression") &&
    guard.test.operator === "!" &&
    isNodeOfType(guard.test.argument, "Identifier") &&
    context.scopes.symbolFor(guard.test.argument) === open &&
    isNodeOfType(guard.consequent, "BlockStatement") &&
    guard.consequent.body.length === 1 &&
    isNodeOfType(guard.consequent.body[0], "ReturnStatement") &&
    !guard.consequent.body[0].argument &&
    isNodeOfType(launch, "ExpressionStatement") &&
    isNodeOfType(launch.expression, "UnaryExpression") &&
    launch.expression.operator === "void" &&
    isNodeOfType(launch.expression.argument, "CallExpression") &&
    !launch.expression.argument.optional &&
    launch.expression.argument.arguments.length === 0 &&
    isNodeOfType(launch.expression.argument.callee, "Identifier") &&
    context.scopes.symbolFor(launch.expression.argument.callee) === request
    ? { callee: launch.expression.argument.callee, dependencies: effect.dependencies }
    : null;
};

const readFalseOnlyUpdater = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const [updater] = call.arguments;
  if (
    !isNodeOfType(updater, "ArrowFunctionExpression") ||
    updater.async ||
    updater.params.length !== 1 ||
    !isNodeOfType(updater.params[0], "Identifier") ||
    !isNodeOfType(updater.body, "ConditionalExpression")
  )
    return false;
  const input = context.scopes.symbolFor(updater.params[0]);
  return Boolean(
    input &&
    context.scopes.symbolFor(updater.body.test) === input &&
    context.scopes.symbolFor(updater.body.alternate) === input &&
    isNodeOfType(updater.body.consequent, "Literal") &&
    updater.body.consequent.value === false,
  );
};

const readUseOfOpenGuard = (node: EsTreeNode | null | undefined, context: RuleContext) =>
  isNodeOfType(node, "IfStatement") &&
  !node.alternate &&
  isNodeOfType(node.test, "UnaryExpression") &&
  node.test.operator === "!" &&
  isNodeOfType(node.test.argument, "Identifier")
    ? context.scopes.symbolFor(node.test.argument)
    : null;

const readCombinedRequestLaunch = (
  statement: EsTreeNode,
  open: SymbolDescriptor,
  view: SymbolDescriptor,
  request: SymbolDescriptor,
  owner: EsTreeNode,
  context: RuleContext,
) => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const effect = readCallback(statement.expression, "useEffect", context);
  if (
    !effect ||
    effect.callback.async ||
    effect.dependencies.length !== 4 ||
    !usesDependency(effect.dependencies, open, context) ||
    !usesDependency(effect.dependencies, view, context) ||
    !usesDependency(effect.dependencies, request, context) ||
    !isNodeOfType(effect.callback.body, "BlockStatement")
  )
    return null;
  const body = effect.callback.body;
  const first = body.body[0];
  const last = body.body.at(-1);
  if (
    !isNodeOfType(first, "IfStatement") ||
    readUseOfOpenGuard(first, context) !== open ||
    !isNodeOfType(first.consequent, "BlockStatement") ||
    !isNodeOfType(first.consequent.body.at(-1), "ReturnStatement") ||
    !isNodeOfType(last, "ExpressionStatement") ||
    !isNodeOfType(last.expression, "UnaryExpression") ||
    last.expression.operator !== "void"
  )
    return null;
  const call = last.expression.argument;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length ||
    !isNodeOfType(call.callee, "Identifier") ||
    context.scopes.symbolFor(call.callee) !== request
  )
    return null;

  const remaining = effect.dependencies.filter(
    (entry) =>
      entry &&
      isNodeOfType(entry, "Identifier") &&
      ![open, view, request].some((binding) => context.scopes.symbolFor(entry) === binding),
  );
  const stable =
    remaining.length === 1 && remaining[0]
      ? readStableCallback(remaining[0], owner, context)
      : null;
  return stable
    ? {
        callee: call.callee,
        dependencies: effect.dependencies,
        stable,
        body,
        closed: first.consequent,
      }
    : null;
};

const readClosedRequestUses = (
  request: SymbolDescriptor,
  launch: NonNullable<ReturnType<typeof readOpenRequestLaunch>>,
  owner: EsTreeNode,
  context: RuleContext,
): boolean | EsTreeNodeOfType<"ExpressionStatement"> => {
  const otherReferences = request.references.filter(
    ({ identifier }) =>
      identifier !== launch.callee && !launch.dependencies.some((node) => node === identifier),
  );
  if (otherReferences.length === 0) return true;
  if (otherReferences.length !== 2 || !isFunctionLike(owner)) return false;
  for (const { identifier } of otherReferences) {
    const call = identifier.parent;
    const awaiting = call?.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== identifier ||
      call.arguments.length !== 0 ||
      !isNodeOfType(awaiting, "AwaitExpression") ||
      awaiting.argument !== call ||
      !isNodeOfType(awaiting.parent, "ExpressionStatement")
    ) {
      continue;
    }
    const callback = findEnclosingFunction(awaiting);
    const hook = callback?.parent;
    const declaration = hook?.parent;
    if (
      !hook ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.init !== hook ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.kind !== "const" ||
      declaration.parent.parent !== owner.body
    ) {
      continue;
    }
    const restore = readCallback(hook, "useCallback", context);
    if (
      restore &&
      restore.callback === callback &&
      restore.callback.async &&
      otherReferences.some((reference) =>
        restore.dependencies.some((node) => node === reference.identifier),
      )
    ) {
      return awaiting.parent;
    }
  }
  return false;
};

const hasClosedRequestUses = (...input: Parameters<typeof readClosedRequestUses>): boolean =>
  Boolean(readClosedRequestUses(...input));

const readMountedLoadingScope = (
  owner: EsTreeNode,
  open: SymbolDescriptor,
  view: SymbolDescriptor,
  getter: SymbolDescriptor,
  context: RuleContext,
): MountedLoadingScope | null => {
  if (
    !isFunctionLike(owner) ||
    open.kind !== "parameter" ||
    open.scope.node !== owner ||
    view.kind !== "parameter" ||
    view.scope.node !== owner
  )
    return null;
  const [parameter] = owner.params;
  if (!parameter) return null;
  if (
    !hasCompleteSymbolReferences(view, owner, context.scopes) ||
    !hasCompleteSymbolReferences(open, owner, context.scopes) ||
    !hasReadonlyReferences(view) ||
    !hasReadonlyReferences(open)
  ) {
    return null;
  }
  const viewProperty = readPlainPropertyBinding(parameter, view);
  const openProperty = readPlainPropertyBinding(parameter, open);
  const getterDeclaration = getter.declarationNode;
  if (
    !viewProperty ||
    !openProperty ||
    getter.kind !== "const" ||
    !isNodeOfType(getterDeclaration, "VariableDeclarator") ||
    getterDeclaration.parent?.parent !== owner.body ||
    !isNodeOfType(getterDeclaration.init, "CallExpression") ||
    getterDeclaration.init.optional ||
    getterDeclaration.init.arguments.length !== 0 ||
    !hasCompleteSymbolReferences(getter, owner, context.scopes) ||
    !hasReadonlyReferences(getter)
  ) {
    return null;
  }
  const contextField = readPlainPropertyBinding(getterDeclaration.id, getter);
  if (!contextField) return null;
  return {
    viewProperty,
    openProperty,
    openBinding: open,
    viewBinding: view,
    getterBinding: getter,
    contextHookCall: getterDeclaration.init,
    contextField,
  };
};

// The reset effect's changing dependencies must also schedule the
// request effect. Provider identity, mounting, and generation
// ownership are checked independently by the caller.
const readLoadingPair = ({
  owner,
  request,
  extraSetterIdentifier,
  firstAwait,
  context,
  resetMode = "after-request",
}: LoadingPairInput): PassiveLoadingPair | RenderLoadingPair | null => {
  const renderAdjustment = resetMode === "render-adjustment";
  const resetBeforeRequest = resetMode === "before-request";
  const requireRequestCleanup = resetMode === "after-request-with-cleanup";
  const releaseInLaunch = resetMode === "within-request";
  if (!isFunctionLike(owner) || !isNodeOfType(owner.body, "BlockStatement")) return null;
  const awaitBinding = firstAwait.parent;
  const awaitStatement = awaitBinding?.parent;
  const tryBlock = awaitStatement?.parent;
  const protectingTry = tryBlock?.parent;
  if (
    !isNodeOfType(awaitBinding, "VariableDeclarator") ||
    !isNodeOfType(awaitBinding.id, "Identifier") ||
    awaitBinding.init !== firstAwait ||
    !isNodeOfType(awaitStatement, "VariableDeclaration") ||
    awaitStatement.kind !== "const" ||
    awaitStatement.declarations.length !== 1 ||
    !isNodeOfType(tryBlock, "BlockStatement") ||
    tryBlock.body[0] !== awaitStatement ||
    !isNodeOfType(protectingTry, "TryStatement") ||
    protectingTry.block !== tryBlock
  ) {
    return null;
  }
  const awaitCall = firstAwait.argument;
  if (
    !isNodeOfType(awaitCall, "CallExpression") ||
    awaitCall.optional ||
    awaitCall.arguments.length !== 1 ||
    !isNodeOfType(awaitCall.callee, "Identifier") ||
    !isNodeOfType(awaitCall.arguments[0], "Identifier")
  ) {
    return null;
  }
  const getter = context.scopes.symbolFor(awaitCall.callee);
  const viewArgument = context.scopes.symbolFor(awaitCall.arguments[0]);
  const view = resolveConstIdentifierAlias(awaitCall.arguments[0], context.scopes);
  const hook = request.parent;
  const declaration = hook?.parent;
  if (
    !getter ||
    !view ||
    !viewArgument ||
    view.kind !== "parameter" ||
    view.scope.node !== owner ||
    !hook ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    declaration.init !== hook ||
    declaration.parent?.parent !== owner.body
  ) {
    return null;
  }
  if (viewArgument !== view) {
    const alias = viewArgument.declarationNode;
    const statement = alias.parent;
    if (
      viewArgument.kind !== "const" ||
      !hasCompleteSymbolReferences(viewArgument, request, context.scopes) ||
      !hasReadonlyReferences(viewArgument) ||
      !isNodeOfType(alias, "VariableDeclarator") ||
      alias.id !== viewArgument.bindingIdentifier ||
      !isNodeOfType(alias.init, "Identifier") ||
      context.scopes.symbolFor(alias.init) !== view ||
      !isFunctionLike(request) ||
      !isNodeOfType(request.body, "BlockStatement") ||
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.parent !== request.body ||
      protectingTry.parent !== request.body ||
      !request.body.body
        .slice(
          0,
          request.body.body.findIndex((item) => item === protectingTry),
        )
        .some((item) => item === statement)
    ) {
      return null;
    }
  }
  const requestHook = readCallback(hook, "useCallback", context);
  const requestBinding = context.scopes.symbolFor(declaration.id);
  if (
    !requestHook ||
    requestHook.callback !== request ||
    !requestHook.callback.async ||
    requestHook.dependencies.length !== (renderAdjustment ? 3 : 2) ||
    !usesDependency(requestHook.dependencies, view, context) ||
    !usesDependency(requestHook.dependencies, getter, context) ||
    requestBinding?.kind !== "const" ||
    !hasCompleteSymbolReferences(requestBinding, owner, context.scopes) ||
    !hasReadonlyReferences(requestBinding)
  ) {
    return null;
  }
  const setterCall = extraSetterIdentifier.parent;
  if (
    !isNodeOfType(setterCall, "CallExpression") ||
    setterCall.optional ||
    setterCall.callee !== extraSetterIdentifier ||
    setterCall.arguments.length !== 1 ||
    !isNodeOfType(setterCall.parent, "ExpressionStatement")
  ) {
    return null;
  }
  const setterBlock = setterCall.parent.parent;
  const releaseGuard = setterBlock?.parent;
  const open = releaseInLaunch
    ? readUseOfOpenGuard(releaseGuard, context)
    : readOpenReset(setterCall.arguments[0], getter, requireRequestCleanup, context);
  if (open?.kind !== "parameter" || open.scope.node !== owner) return null;
  const scope = readMountedLoadingScope(owner, open, view, getter, context);
  if (!scope) return null;

  if (releaseInLaunch) {
    const owningEffect = releaseGuard?.parent?.parent?.parent?.parent;
    if (
      !isNodeOfType(owningEffect, "ExpressionStatement") ||
      owningEffect.parent !== owner.body ||
      !readFalseOnlyUpdater(setterCall, context)
    )
      return null;
    const combined = readCombinedRequestLaunch(
      owningEffect,
      open,
      view,
      requestBinding,
      owner,
      context,
    );
    return combined && combined.closed === setterBlock
      ? {
          ...scope,
          requestEffect: owningEffect,
          requestCleanup: null,
          resetBody: combined.body,
          stableReset: combined.stable,
          releaseInLaunch: true,
        }
      : null;
  }
  if (renderAdjustment) {
    const block = setterCall.parent.parent;
    const adjustment = block?.parent;
    if (
      !usesDependency(requestHook.dependencies, open, context) ||
      !isNodeOfType(block, "BlockStatement") ||
      !isNodeOfType(adjustment, "IfStatement") ||
      adjustment.consequent !== block ||
      adjustment.alternate ||
      adjustment.parent !== owner.body
    ) {
      return null;
    }
    const adjustmentIndex = owner.body.body.findIndex((statement) => statement === adjustment);
    const requestIndex = owner.body.body.findIndex((statement) => statement === declaration.parent);
    if (adjustmentIndex < 0 || requestIndex <= adjustmentIndex) return null;
    const launch = owner.body.body
      .slice(requestIndex + 1)
      .map((statement) => readOpenRequestLaunch(statement, open, requestBinding, context))
      .find((item) => item !== null);
    return launch && hasClosedRequestUses(requestBinding, launch, owner, context)
      ? { ...scope, adjustment }
      : null;
  }
  const effectBlock = setterCall.parent.parent;
  const effectCallback = effectBlock?.parent;
  const effectCall = effectCallback?.parent;
  const effectStatement = effectCall?.parent;
  if (
    !effectCall ||
    !isNodeOfType(effectBlock, "BlockStatement") ||
    !isNodeOfType(effectStatement, "ExpressionStatement") ||
    effectStatement.parent !== owner.body
  ) {
    return null;
  }
  const resetEffect = readCallback(effectCall, "useEffect", context);
  if (
    !resetEffect ||
    resetEffect.callback !== effectCallback ||
    resetEffect.callback.async ||
    resetEffect.dependencies.length !== (requireRequestCleanup ? 4 : 3) ||
    (requireRequestCleanup && !usesDependency(resetEffect.dependencies, getter, context)) ||
    !usesDependency(resetEffect.dependencies, view, context) ||
    !usesDependency(resetEffect.dependencies, open, context)
  ) {
    return null;
  }
  const stable = resetEffect.dependencies.filter(
    (node) =>
      node &&
      !usesDependency([node], view, context) &&
      !usesDependency([node], open, context) &&
      (!requireRequestCleanup || !usesDependency([node], getter, context)),
  );
  const stableReset =
    stable.length === 1 && stable[0] ? readStableCallback(stable[0], owner, context) : null;
  if (!stableReset) return null;
  const resetIndex = owner.body.body.findIndex((statement) => statement === effectStatement);
  const requestEffect = resetBeforeRequest
    ? owner.body.body[resetIndex + 1]
    : owner.body.body
        .slice(0, resetIndex)
        .find((statement) =>
          readOpenRequestLaunch(statement, open, requestBinding, context, requireRequestCleanup),
        );
  if (!requestEffect) return null;
  const requestCleanup = requireRequestCleanup
    ? readGenerationCleanup(requestEffect, context)
    : null;
  if (requireRequestCleanup && !requestCleanup) return null;
  if (resetBeforeRequest) {
    const launch = readOpenRequestLaunch(requestEffect, open, requestBinding, context);
    if (!launch || !hasClosedRequestUses(requestBinding, launch, owner, context)) return null;
  }

  return { ...scope, requestEffect, requestCleanup, resetBody: effectBlock, stableReset };
};

export const isDirectNamedReactHookCall = (
  hook: EsTreeNode | null | undefined,
  api: "useCallback" | "useEffect" | "useRef",
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(hook, "CallExpression") ||
    hook.optional ||
    !isNodeOfType(hook.callee, "Identifier")
  )
    return false;
  const symbol = context.scopes.symbolFor(hook.callee);
  const specifier = symbol?.declarationNode;
  const imported = specifier?.parent;
  return Boolean(
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(specifier.imported, "Identifier") &&
    specifier.imported.name === api &&
    isNodeOfType(imported, "ImportDeclaration") &&
    imported.importKind !== "type" &&
    imported.source.value === "react" &&
    imported.parent === context.scopes.rootScope.node &&
    symbol === context.scopes.symbolFor(specifier.local),
  );
};

interface LocalCancellationInput {
  readonly owner: EsTreeNode;
  readonly request: EsTreeNode;
  readonly firstAwait: EsTreeNodeOfType<"AwaitExpression">;
  readonly cancelled: SymbolDescriptor;
  readonly context: RuleContext;
}

interface LocallyCancelledLoadingPair extends MountedLoadingScope {
  readonly stableReset: StableResetCallback;
  readonly disposal: EsTreeNode;
}

export const readLocallyCancelledLoadingPair = ({
  owner,
  request,
  firstAwait,
  cancelled,
  context,
}: LocalCancellationInput): LocallyCancelledLoadingPair | null => {
  if (!isFunctionLike(owner)) return null;
  const requestExpression = findTransparentExpressionRoot(request);
  const launch = requestExpression.parent;
  const discarded = launch?.parent;
  const statement = discarded?.parent;
  const effectBody = statement?.parent;
  const effectCallback = effectBody?.parent;
  const effectCall = effectCallback?.parent;
  const effectStatement = effectCall?.parent;
  if (
    !isNodeOfType(request, "ArrowFunctionExpression") ||
    !request.async ||
    request.params.length !== 0 ||
    !isNodeOfType(launch, "CallExpression") ||
    launch.callee !== requestExpression ||
    launch.optional ||
    launch.arguments.length !== 0 ||
    !isNodeOfType(discarded, "UnaryExpression") ||
    discarded.operator !== "void" ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(effectBody, "BlockStatement") ||
    !isNodeOfType(effectStatement, "ExpressionStatement") ||
    effectStatement.parent !== owner.body ||
    !effectCall
  )
    return null;
  const effect = readCallback(effectCall, "useEffect", context);
  if (
    !effect ||
    !isDirectNamedReactHookCall(effectCall, "useEffect", context) ||
    effect.callback !== effectCallback ||
    effect.callback.async ||
    effect.dependencies.length !== 4 ||
    effectBody.body.length !== 4
  )
    return null;

  const [closed, declaration, launchStatement, returned] = effectBody.body;
  const open = readUseOfOpenGuard(closed, context);
  const closedExit =
    isNodeOfType(closed, "IfStatement") && isNodeOfType(closed.consequent, "BlockStatement")
      ? closed.consequent.body.at(-1)
      : null;
  const cancelDeclaration = cancelled.declarationNode;
  const cleanup = isNodeOfType(returned, "ReturnStatement") ? returned.argument : null;
  if (
    !open ||
    !isNodeOfType(closedExit, "ReturnStatement") ||
    closedExit.argument ||
    declaration !== cancelDeclaration.parent ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "let" ||
    declaration.declarations.length !== 1 ||
    !isNodeOfType(cancelDeclaration, "VariableDeclarator") ||
    cancelDeclaration.id !== cancelled.bindingIdentifier ||
    !isNodeOfType(cancelDeclaration.init, "Literal") ||
    cancelDeclaration.init.value !== false ||
    !hasCompleteSymbolReferences(cancelled, effect.callback, context.scopes) ||
    launchStatement !== statement ||
    !isNodeOfType(cleanup, "ArrowFunctionExpression") ||
    cleanup.async ||
    cleanup.params.length !== 0 ||
    !isNodeOfType(cleanup.body, "BlockStatement") ||
    cleanup.body.body.length !== 2
  )
    return null;
  const [retire, disposal] = cleanup.body.body;
  const write = isNodeOfType(retire, "ExpressionStatement") ? retire.expression : null;
  if (
    !isNodeOfType(write, "AssignmentExpression") ||
    write.operator !== "=" ||
    !isNodeOfType(write.left, "Identifier") ||
    context.scopes.symbolFor(write.left) !== cancelled ||
    !isNodeOfType(write.right, "Literal") ||
    write.right.value !== true ||
    !cancelled.references.every(
      ({ flag, identifier }) =>
        identifier === write.left || (flag === "read" && !isWithinAssignmentTarget(identifier)),
    )
  )
    return null;

  const awaited = firstAwait.parent;
  const awaitedStatement = awaited?.parent;
  const requestBody = awaitedStatement?.parent;
  const owningTry = requestBody?.parent;
  if (
    !isNodeOfType(awaited, "VariableDeclarator") ||
    !isNodeOfType(awaited.id, "Identifier") ||
    awaited.init !== firstAwait ||
    !isNodeOfType(awaitedStatement, "VariableDeclaration") ||
    awaitedStatement.kind !== "const" ||
    awaitedStatement.declarations.length !== 1 ||
    !isNodeOfType(requestBody, "BlockStatement") ||
    requestBody.body[0] !== awaitedStatement ||
    !isNodeOfType(owningTry, "TryStatement") ||
    owningTry.block !== requestBody ||
    owningTry.parent !== request.body
  )
    return null;
  const call = firstAwait.argument;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 1 ||
    !isNodeOfType(call.callee, "Identifier") ||
    !isNodeOfType(call.arguments[0], "Identifier")
  )
    return null;
  const getter = context.scopes.symbolFor(call.callee);
  const view = context.scopes.symbolFor(call.arguments[0]);
  if (!getter || !view) return null;
  const scope = readMountedLoadingScope(owner, open, view, getter, context);
  if (
    !scope ||
    ![open, getter, view].every((symbol) => usesDependency(effect.dependencies, symbol, context))
  )
    return null;
  const cleaner = effect.dependencies.find(
    (entry) =>
      entry && ![open, getter, view].some((symbol) => context.scopes.symbolFor(entry) === symbol),
  );
  const stableReset = cleaner && readStableCallback(cleaner, owner, context);
  return stableReset &&
    isDirectNamedReactHookCall(stableReset.binding.initializer, "useCallback", context)
    ? { ...scope, stableReset, disposal }
    : null;
};

export const readPassiveLoadingPair = (
  input: PassiveLoadingPairInput,
): PassiveLoadingPair | null => {
  const pair = readLoadingPair(input);
  return pair && "stableReset" in pair ? pair : null;
};

export const readRenderLoadingPair = (input: RenderLoadingPairInput): RenderLoadingPair | null => {
  const pair = readLoadingPair({ ...input, resetMode: "render-adjustment" });
  return pair && "adjustment" in pair ? pair : null;
};

export const readDismissiveLoadingPair = (
  input: RenderLoadingPairInput,
): (PassiveLoadingPair & { readonly dismissalProperty: string }) | null => {
  const pair =
    readPassiveLoadingPair(input) ??
    readPassiveLoadingPair({ ...input, resetMode: "within-request" });
  const { context, owner, request } = input;
  const declarator = request.parent?.parent;
  if (!pair || !isFunctionLike(owner) || !isNodeOfType(declarator, "VariableDeclarator")) {
    return null;
  }
  const requestBinding = context.scopes.symbolFor(declarator.id);
  if (!requestBinding) return null;
  const launch = pair.releaseInLaunch
    ? readCombinedRequestLaunch(
        pair.requestEffect,
        pair.openBinding,
        pair.viewBinding,
        requestBinding,
        owner,
        context,
      )
    : readOpenRequestLaunch(pair.requestEffect, pair.openBinding, requestBinding, context);
  const restore = launch && readClosedRequestUses(requestBinding, launch, owner, context);
  if (
    !isNodeOfType(restore, "ExpressionStatement") ||
    !isNodeOfType(restore.parent, "BlockStatement")
  ) {
    return null;
  }
  const tryBlock = restore.parent;
  const tryStatement = tryBlock.parent;
  const next = tryBlock.body[tryBlock.body.findIndex((statement) => statement === restore) + 1];
  if (
    !isNodeOfType(tryStatement, "TryStatement") ||
    tryStatement.block !== tryBlock ||
    !isNodeOfType(next, "ExpressionStatement") ||
    tryBlock.body.at(-1) !== next
  ) {
    return null;
  }
  const close = next.expression;
  if (
    !isNodeOfType(close, "CallExpression") ||
    close.optional ||
    !isNodeOfType(close.callee, "Identifier") ||
    close.arguments.length !== 1 ||
    !isNodeOfType(close.arguments[0], "Literal") ||
    close.arguments[0].value !== false
  ) {
    return null;
  }
  const binding = context.scopes.symbolFor(close.callee);
  const [props] = owner.params;
  if (
    !binding ||
    binding.kind !== "parameter" ||
    binding.scope.node !== owner ||
    !props ||
    !hasCompleteSymbolReferences(binding, owner, context.scopes) ||
    !hasReadonlyReferences(binding)
  ) {
    return null;
  }
  const dismissalProperty = readPlainPropertyBinding(props, binding);
  return dismissalProperty ? { ...pair, dismissalProperty } : null;
};
