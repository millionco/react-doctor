import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface PassiveLoadingPairInput {
  readonly owner: EsTreeNode;
  readonly request: EsTreeNode;
  readonly extraSetterIdentifier: EsTreeNode;
  readonly firstAwait: EsTreeNodeOfType<"AwaitExpression">;
  readonly context: RuleContext;
}

interface PassiveLoadingPair {
  readonly viewProperty: string;
  readonly openProperty: string;
  readonly openBinding: SymbolDescriptor;
  readonly viewBinding: SymbolDescriptor;
  readonly getterBinding: SymbolDescriptor;
  readonly earlierEffect: EsTreeNode;
  readonly contextHookCall: EsTreeNodeOfType<"CallExpression">;
  readonly contextField: string;
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

const readStableCallback = (dependency: EsTreeNode, owner: EsTreeNode, context: RuleContext) => {
  if (!isNodeOfType(dependency, "Identifier")) return false;
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
    return false;
  }
  if (!isFunctionLike(owner) || declaration.parent?.parent !== owner.body) return false;
  const hook = readCallback(declaration.init, "useCallback", context);
  return Boolean(hook && !hook.callback.async && hook.dependencies.length === 0);
};

const launchesRequestWhenOpen = (
  statement: EsTreeNode,
  open: SymbolDescriptor,
  request: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const effect = readCallback(statement.expression, "useEffect", context);
  if (
    !effect ||
    effect.callback.async ||
    effect.dependencies.length !== 2 ||
    !usesDependency(effect.dependencies, open, context) ||
    !usesDependency(effect.dependencies, request, context) ||
    !isNodeOfType(effect.callback.body, "BlockStatement") ||
    effect.callback.body.body.length !== 2
  ) {
    return false;
  }
  const [guard, launch] = effect.callback.body.body;
  return Boolean(
    isNodeOfType(guard, "IfStatement") &&
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
    context.scopes.symbolFor(launch.expression.argument.callee) === request,
  );
};

// The later effect's only changing dependencies must also schedule the
// earlier request effect. Provider identity, mounting, and generation
// ownership are checked independently by the caller.
export const readPassiveLoadingPair = ({
  owner,
  request,
  extraSetterIdentifier,
  firstAwait,
  context,
}: PassiveLoadingPairInput): PassiveLoadingPair | null => {
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
    requestHook.dependencies.length !== 2 ||
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
    !isNodeOfType(setterCall.arguments[0], "Identifier") ||
    !isNodeOfType(setterCall.parent, "ExpressionStatement")
  ) {
    return null;
  }
  const open = context.scopes.symbolFor(setterCall.arguments[0]);
  const effectBlock = setterCall.parent.parent;
  const effectCallback = effectBlock?.parent;
  const effectCall = effectCallback?.parent;
  const effectStatement = effectCall?.parent;
  if (
    open?.kind !== "parameter" ||
    open.scope.node !== owner ||
    !effectCall ||
    !isNodeOfType(effectBlock, "BlockStatement") ||
    !isNodeOfType(effectStatement, "ExpressionStatement") ||
    effectStatement.parent !== owner.body
  ) {
    return null;
  }
  const laterEffect = readCallback(effectCall, "useEffect", context);
  if (
    !laterEffect ||
    laterEffect.callback !== effectCallback ||
    laterEffect.callback.async ||
    laterEffect.dependencies.length !== 3 ||
    !usesDependency(laterEffect.dependencies, view, context) ||
    !usesDependency(laterEffect.dependencies, open, context)
  ) {
    return null;
  }
  const stable = laterEffect.dependencies.filter(
    (node) =>
      node && !usesDependency([node], view, context) && !usesDependency([node], open, context),
  );
  if (stable.length !== 1 || !stable[0] || !readStableCallback(stable[0], owner, context)) {
    return null;
  }
  const laterIndex = owner.body.body.findIndex((statement) => statement === effectStatement);
  const earlierEffect =
    laterIndex > 0 &&
    owner.body.body
      .slice(0, laterIndex)
      .find((statement) => launchesRequestWhenOpen(statement, open, requestBinding, context));
  if (!earlierEffect) return null;

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
  return contextField
    ? {
        viewProperty,
        openProperty,
        openBinding: open,
        viewBinding: view,
        getterBinding: getter,
        earlierEffect,
        contextHookCall: getterDeclaration.init,
        contextField,
      }
    : null;
};
