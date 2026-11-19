import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { EffectStateWriteFact } from "./collect-effect-state-write-facts.js";
import { getRef } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { isNoOpCleanupFunction } from "./effect/is-no-op-cleanup-function.js";
import { getEffectFn, resolveStateSetterReference } from "./effect/react.js";
import { isProvenReactRefCurrentExpression } from "./resolve-parent-callback-provenance.js";

const getDirectCall = (
  expression: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const call = expression ? stripParenExpression(expression) : null;
  return isNodeOfType(call, "CallExpression") && !call.optional ? call : null;
};

const getStatementCall = (
  statement: EsTreeNode | undefined,
): EsTreeNodeOfType<"CallExpression"> | null =>
  isNodeOfType(statement, "ExpressionStatement") ? getDirectCall(statement.expression) : null;

const getBinding = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): SymbolDescriptor | null => {
  const identifier = expression ? stripParenExpression(expression) : null;
  return isNodeOfType(identifier, "Identifier") ? context.scopes.symbolFor(identifier) : null;
};

const getReadOnlyConst = (
  expression: EsTreeNode | null | undefined,
  context: RuleContext,
): SymbolDescriptor | null => {
  const symbol = getBinding(expression, context);
  return symbol?.kind === "const" &&
    isSymbolReadOnly(symbol) &&
    hasCompleteSymbolReferences(symbol, context.scopes.rootScope.node, context.scopes)
    ? symbol
    : null;
};

const getSetup = (analysis: ProgramAnalysis, effect: EsTreeNode, context: RuleContext) => {
  const effectFunction = getEffectFn(analysis, effect);
  if (
    !isFunctionLike(effectFunction) ||
    effectFunction.async ||
    effectFunction.generator ||
    !isNodeOfType(effectFunction.body, "BlockStatement")
  ) {
    return null;
  }
  const statements = effectFunction.body.body;
  const declaration = statements.at(-2);
  const returned = statements.at(-1);
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    !isNodeOfType(returned, "ReturnStatement")
  ) {
    return null;
  }
  const result = getReadOnlyConst(returned.argument, context);
  if (
    !result ||
    result.declarationNode !== declaration.declarations[0] ||
    result.references.length !== 1
  )
    return null;
  const invocation = getDirectCall(getDirectConstInitializer(result));
  if (!invocation || invocation.arguments.length !== 0) return null;
  const setupBinding = getReadOnlyConst(invocation.callee, context);
  const wrapper = setupBinding && getDirectCall(getDirectConstInitializer(setupBinding));
  const hook = wrapper && getBinding(wrapper.callee, context);
  if (
    !wrapper ||
    !isNodeOfType(hook?.declarationNode, "ImportSpecifier") ||
    wrapper.arguments.length !== 2 ||
    !isReactApiCall(wrapper, "useCallback", context.scopes, {
      allowGlobalReactNamespace: false,
      allowUnboundBareCalls: false,
      resolveNamedAliases: true,
    })
  ) {
    return null;
  }
  const callback = wrapper.arguments[0];
  const setup = callback ? stripParenExpression(callback) : null;
  return isFunctionLike(setup) &&
    !setup.async &&
    !setup.generator &&
    setup.params.length === 0 &&
    isNodeOfType(setup.body, "BlockStatement")
    ? { setup, body: setup.body, effectPrefix: statements.slice(0, -2) }
    : null;
};

const isNoOpReturn = (node: EsTreeNode | undefined, analysis: ProgramAnalysis): boolean => {
  if (!isNodeOfType(node, "ReturnStatement") || !node.argument) return false;
  const value = stripParenExpression(node.argument);
  return isFunctionLike(value) && isNoOpCleanupFunction(analysis, value);
};

const readStateSetter = (
  call: EsTreeNodeOfType<"CallExpression"> | null,
  analysis: ProgramAnalysis,
) => {
  if (!call || call.arguments.length !== 1) return null;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const reference = getRef(analysis, callee);
  return reference ? (resolveStateSetterReference(analysis, reference)?.resolved ?? null) : null;
};

const writesRefFromParameter = (
  statement: EsTreeNode,
  ref: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const assignment = stripParenExpression(statement.expression);
  if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=")
    return false;
  const target = stripParenExpression(assignment.left);
  return (
    isNodeOfType(target, "MemberExpression") &&
    !target.computed &&
    isNodeOfType(target.property, "Identifier") &&
    target.property.name === "current" &&
    getBinding(target.object, context) === ref &&
    getBinding(assignment.right, context)?.kind === "parameter"
  );
};

const getMissingInputs = (
  guard: EsTreeNode,
  setup: EsTreeNode,
  effectPrefix: ReadonlyArray<EsTreeNode>,
  analysis: ProgramAnalysis,
  context: RuleContext,
): ReadonlySet<SymbolDescriptor> | null => {
  const test = stripParenExpression(guard);
  const terms =
    isNodeOfType(test, "LogicalExpression") && test.operator === "||"
      ? [stripParenExpression(test.left), stripParenExpression(test.right)]
      : [test];
  const inputs = new Set<SymbolDescriptor>();
  for (const term of terms) {
    if (!isNodeOfType(term, "UnaryExpression") || term.operator !== "!") return null;
    const input = getReadOnlyConst(term.argument, context);
    if (!input || findEnclosingFunction(input.declarationNode) !== setup) return null;
    const initializer = getDirectConstInitializer(input);
    const snapshot = initializer ? stripParenExpression(initializer) : null;
    if (
      !isNodeOfType(snapshot, "MemberExpression") ||
      !isProvenReactRefCurrentExpression({ analysis, expression: snapshot, scopes: context.scopes })
    )
      return null;
    const ref = getBinding(snapshot.object, context);
    const firstStatement = effectPrefix[0];
    const lastStatement = effectPrefix.at(-1);
    if (!ref || !firstStatement || !lastStatement) return null;
    // A second use in the effect prefix could overwrite the input or expose
    // the ref to code that changes it before setup reads the snapshot.
    const prefixReferences = ref.references.filter(
      ({ identifier }) =>
        identifier.range[0] >= firstStatement.range[0] &&
        identifier.range[1] <= lastStatement.range[1],
    );
    if (
      prefixReferences.length !== 1 ||
      !effectPrefix.some((statement) => writesRefFromParameter(statement, ref, context))
    ) {
      return null;
    }
    inputs.add(input);
  }
  return inputs;
};

const getListenerCall = (
  call: EsTreeNodeOfType<"CallExpression"> | null,
  method: string,
  context: RuleContext,
) => {
  if (!call || call.arguments.length !== 1) return null;
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== method
  ) {
    return null;
  }
  const receiver = getReadOnlyConst(callee.object, context);
  const listener = getReadOnlyConst(call.arguments[0], context);
  return receiver && listener ? { receiver, listener } : null;
};

const getReturnedSubscription = (
  body: EsTreeNodeOfType<"BlockStatement">,
  setup: EsTreeNode,
  context: RuleContext,
) => {
  const registrationCall = getStatementCall(body.body.at(-2));
  if (!registrationCall || !isNodeReachableWithinFunction(registrationCall, context)) return null;
  const registration = getListenerCall(registrationCall, "on", context);
  const returned = body.body.at(-1);
  if (
    !registration ||
    findEnclosingFunction(registration.receiver.declarationNode) !== setup ||
    findEnclosingFunction(registration.listener.declarationNode) !== setup ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !returned.argument
  ) {
    return null;
  }
  const listener = getDirectConstInitializer(registration.listener);
  const cleanup = stripParenExpression(returned.argument);
  if (
    !isFunctionLike(listener) ||
    listener.async ||
    listener.generator ||
    !isFunctionLike(cleanup) ||
    cleanup.async ||
    cleanup.generator ||
    cleanup.params.length !== 0
  ) {
    return null;
  }
  const releaseCall = isNodeOfType(cleanup.body, "BlockStatement")
    ? cleanup.body.body.length === 1
      ? getStatementCall(cleanup.body.body[0])
      : null
    : getDirectCall(cleanup.body);
  const release = getListenerCall(releaseCall, "off", context);
  return release?.receiver === registration.receiver && release.listener === registration.listener
    ? { receiver: registration.receiver, listener, returned }
    : null;
};

const dependsOnMissingInputs = (
  receiver: SymbolDescriptor,
  inputs: ReadonlySet<SymbolDescriptor>,
  context: RuleContext,
): boolean => {
  if (inputs.has(receiver)) return true;
  const initializer = getDirectCall(getDirectConstInitializer(receiver));
  return Boolean(
    initializer &&
    initializer.arguments.length > 0 &&
    initializer.arguments.every((argument) => {
      const binding = getBinding(argument, context);
      return binding !== null && inputs.has(binding);
    }),
  );
};

const getMemberIdentity = (expression: EsTreeNode, context: RuleContext): string | null => {
  const member = stripParenExpression(expression);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.optional ||
    member.computed ||
    !isNodeOfType(member.property, "Identifier")
  ) {
    return null;
  }
  const receiver = getReadOnlyConst(member.object, context);
  return receiver ? `${receiver.id}.${member.property.name}` : null;
};

const getDerivedRefreshMethod = (
  expression: EsTreeNode | undefined,
  receiver: SymbolDescriptor,
  context: RuleContext,
): string | null => {
  const call = getDirectCall(expression);
  return call && call.arguments.length === 1 && getBinding(call.arguments[0], context) === receiver
    ? getMemberIdentity(call.callee, context)
    : null;
};

const collectMatchingStateWrites = (
  statements: ReadonlyArray<EsTreeNode>,
  fact: EffectStateWriteFact,
  analysis: ProgramAnalysis,
  context: RuleContext,
): Array<{ call: EsTreeNodeOfType<"CallExpression">; guard: EsTreeNode | null }> => {
  const writes: Array<{ call: EsTreeNodeOfType<"CallExpression">; guard: EsTreeNode | null }> = [];
  for (const statement of statements) {
    const direct = getStatementCall(statement);
    if (
      direct &&
      isNodeReachableWithinFunction(direct, context) &&
      readStateSetter(direct, analysis) === fact.setterReference.resolved
    ) {
      writes.push({ call: direct, guard: null });
      continue;
    }
    if (
      !isNodeOfType(statement, "IfStatement") ||
      statement.alternate ||
      !isNodeOfType(statement.consequent, "BlockStatement") ||
      statement.consequent.body.length !== 1
    ) {
      continue;
    }
    const guarded = getStatementCall(statement.consequent.body[0]);
    if (
      guarded &&
      isNodeReachableWithinFunction(guarded, context) &&
      readStateSetter(guarded, analysis) === fact.setterReference.resolved
    ) {
      writes.push({ call: guarded, guard: statement.test });
    }
  }
  return writes;
};

const writesSubscribedState = (
  statements: ReadonlyArray<EsTreeNode>,
  subscription: NonNullable<ReturnType<typeof getReturnedSubscription>>,
  fact: EffectStateWriteFact,
  analysis: ProgramAnalysis,
  context: RuleContext,
): boolean => {
  const setupWrites = collectMatchingStateWrites(statements, fact, analysis, context);
  if (
    setupWrites.some(
      ({ call, guard }) =>
        !guard && getBinding(call.arguments[0], context) === subscription.receiver,
    )
  )
    return true;

  // Derived state is tied to the subscription only when setup and the
  // registered listener refresh that setter through the same member read.
  if (!isNodeOfType(subscription.listener.body, "BlockStatement")) return false;
  const listenerWrites = collectMatchingStateWrites(
    subscription.listener.body.body,
    fact,
    analysis,
    context,
  );
  return setupWrites.some(({ call, guard }) => {
    const read = getDerivedRefreshMethod(call.arguments[0], subscription.receiver, context);
    return Boolean(
      read &&
      guard &&
      getMemberIdentity(guard, context) === read &&
      listenerWrites.some(
        ({ call: listenerCall, guard: listenerGuard }) =>
          listenerGuard &&
          getMemberIdentity(listenerGuard, context) === read &&
          getDerivedRefreshMethod(listenerCall.arguments[0], subscription.receiver, context) ===
            read,
      ),
    );
  });
};

export const isReturnedSubscriptionStateReset = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  effect: EsTreeNode,
  fact: EffectStateWriteFact,
): boolean => {
  const write = getDirectCall(fact.callExpression);
  const value = write?.arguments[0] ? stripParenExpression(write.arguments[0]) : null;
  if (
    !write ||
    !fact.setterReference.resolved ||
    !isNodeOfType(value, "Literal") ||
    value.value !== null ||
    !isNodeOfType(write.parent, "ExpressionStatement") ||
    !isNodeOfType(write.parent.parent, "BlockStatement")
  ) {
    return false;
  }
  const resetBody = write.parent.parent;
  const guard = resetBody.parent;
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.consequent !== resetBody ||
    guard.alternate ||
    !isNoOpReturn(resetBody.body.at(-1), analysis) ||
    !resetBody.body
      .slice(0, -1)
      .every((statement) => readStateSetter(getStatementCall(statement), analysis))
  ) {
    return false;
  }
  const ownedSetup = getSetup(analysis, effect, context);
  if (!ownedSetup || guard.parent !== ownedSetup.body) return false;
  const { setup, body, effectPrefix } = ownedSetup;
  const missingInputs = getMissingInputs(guard.test, setup, effectPrefix, analysis, context);
  if (!missingInputs) return false;
  const guardIndex = body.body.findIndex((statement) => statement === guard);
  if (
    guardIndex === -1 ||
    !body.body.slice(0, guardIndex).every(
      (statement) =>
        isNodeOfType(statement, "VariableDeclaration") &&
        statement.kind === "const" &&
        statement.declarations.every(
          (declaration) =>
            declaration.init &&
            isProvenReactRefCurrentExpression({
              analysis,
              expression: declaration.init,
              scopes: context.scopes,
            }),
        ),
    )
  )
    return false;
  const laterStatements = body.body.slice(guardIndex + 1);
  for (const statement of [body, ...laterStatements]) {
    const candidateBody =
      isNodeOfType(statement, "IfStatement") && !statement.alternate
        ? statement.consequent
        : statement;
    if (
      !isNodeOfType(candidateBody, "BlockStatement") ||
      (statement === candidateBody && candidateBody !== body)
    )
      continue;
    const subscription = getReturnedSubscription(candidateBody, setup, context);
    if (
      !subscription ||
      (statement !== body &&
        (!isNodeOfType(statement, "IfStatement") ||
          getBinding(statement.test, context) !== subscription.receiver)) ||
      !dependsOnMissingInputs(subscription.receiver, missingInputs, context) ||
      !collectFunctionReturnStatements(setup).every(
        (returned) => returned === subscription.returned || isNoOpReturn(returned, analysis),
      )
    ) {
      continue;
    }
    const setupStatements = candidateBody === body ? laterStatements : candidateBody.body;
    if (
      writesSubscribedState(setupStatements.slice(0, -2), subscription, fact, analysis, context)
    ) {
      return true;
    }
  }
  return false;
};
