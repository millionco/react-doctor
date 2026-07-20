import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getClassBindingSymbol } from "../../utils/get-class-binding-symbol.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isResultDiscardedCall } from "../../utils/is-result-discarded-call.js";
import { MOBX_RULE_GATES } from "../../utils/mobx-rule-gates.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import { resolveStableOptionsObject } from "../../utils/resolve-stable-options-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const MESSAGE =
  "This MobX reaction discards its disposer and can outlive its owner. Store and dispose it during teardown, or provide an AbortSignal.";
const LEAKING_SUBSCRIPTION_NAMES = new Set(["reaction", "autorun"]);
const OPTIONS_ARGUMENT_INDEX: Readonly<Record<string, number>> = { autorun: 1, reaction: 2 };
const DISPOSER_COERCION_NAMES = new Set(["Boolean", "Number", "String"]);
const NON_OBSERVABLE_GLOBAL_RECEIVER_NAMES = new Set([
  "Array",
  "Boolean",
  "JSON",
  "Math",
  "Number",
  "Object",
  "String",
  "console",
]);
const NON_OBSERVING_IMPORTED_METHOD_NAMES = new Set([
  "add",
  "clear",
  "delete",
  "remove",
  "save",
  "set",
  "update",
  "write",
]);
const REACTION_PARAMETER_INDEX: Readonly<Record<string, number>> = { autorun: 0, reaction: 2 };
const REACTION_CALLBACK_INDEX: Readonly<Record<string, number>> = { autorun: 0, reaction: 1 };
const OBSERVATION_CALLBACK_INDEX: Readonly<Record<string, number>> = { autorun: 0, reaction: 0 };
const PROCESS_LIFETIME_WIRING_NAME_PATTERN =
  /^(?:register.*(?:reactions?|autoruns?)|init.*(?:stores?|reactions?|autoruns?)|setup.*(?:stores?|reactions?|autoruns?)|bootstrap(?:app(?:lication)?|stores?|reactions?|autoruns?))$/i;

const resolveLeakingSubscriptionName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): string | null => {
  const reference = resolveImportedApiReference(callExpression.callee, scopes);
  if (
    reference?.source !== "mobx" ||
    !reference.importedName ||
    !LEAKING_SUBSCRIPTION_NAMES.has(reference.importedName)
  ) {
    return null;
  }
  return reference.importedName;
};

const isEvaluatedAtModuleScope = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "PropertyDefinition") ||
      isNodeOfType(ancestor, "AccessorProperty")
    ) {
      if (!ancestor.static) return false;
      ancestor = ancestor.parent ?? null;
      continue;
    }
    if (isNodeOfType(ancestor, "StaticBlock")) {
      ancestor = ancestor.parent ?? null;
      continue;
    }
    if (isFunctionLike(ancestor)) {
      const functionRoot = findTransparentExpressionRoot(ancestor);
      const invocation = functionRoot.parent;
      if (
        isNodeOfType(invocation, "CallExpression") &&
        stripParenExpression(invocation.callee) === functionRoot
      ) {
        ancestor = invocation.parent ?? null;
        continue;
      }
      return false;
    }
    ancestor = ancestor.parent ?? null;
  }
  return true;
};

const getFunctionName = (functionNode: EsTreeNode): string | null => {
  if (
    isNodeOfType(functionNode, "FunctionDeclaration") &&
    isNodeOfType(functionNode.id, "Identifier")
  ) {
    return functionNode.id.name;
  }
  const parent = functionNode.parent;
  return isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")
    ? parent.id.name
    : null;
};

const isModuleScopedFunction = (functionNode: EsTreeNode): boolean => {
  let ancestor = functionNode.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor) || isNodeOfType(ancestor, "ClassBody")) return false;
    if (isNodeOfType(ancestor, "Program")) return true;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const getDirectCalls = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<EsTreeNodeOfType<"CallExpression">> => {
  const bindingIdentifier = isNodeOfType(functionNode, "FunctionDeclaration")
    ? functionNode.id
    : isNodeOfType(functionNode.parent, "VariableDeclarator")
      ? functionNode.parent.id
      : null;
  if (!bindingIdentifier || !isNodeOfType(bindingIdentifier, "Identifier")) return [];
  const symbol = scopes.scopeFor(functionNode).symbolsByName.get(bindingIdentifier.name);
  if (!symbol) return [];
  const calls: Array<EsTreeNodeOfType<"CallExpression">> = [];
  const program = findProgramRoot(functionNode);
  if (!program) return calls;
  walkAst(program, (candidate) => {
    if (!isNodeOfType(candidate, "CallExpression")) return;
    const callee = stripParenExpression(candidate.callee);
    if (!isNodeOfType(callee, "Identifier")) return;
    if (resolveConstIdentifierAlias(callee, scopes)?.id === symbol.id) calls.push(candidate);
  });
  return calls;
};

const processLifetimeClassSymbolIdsByAnalysis = new WeakMap<ScopeAnalysis, ReadonlySet<number>>();

const getProcessLifetimeClassSymbolIds = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlySet<number> => {
  const cached = processLifetimeClassSymbolIdsByAnalysis.get(scopes);
  if (cached) return cached;
  const instantiationScopeBySymbolId = new Map<number, boolean>();
  const program = findProgramRoot(node);
  if (program) {
    walkAst(program, (candidate) => {
      if (!isNodeOfType(candidate, "NewExpression")) return;
      const callee = stripParenExpression(candidate.callee);
      const symbol = isNodeOfType(callee, "Identifier")
        ? resolveConstIdentifierAlias(callee, scopes)
        : null;
      if (!symbol) return;
      const wasModuleOnly = instantiationScopeBySymbolId.get(symbol.id) ?? true;
      instantiationScopeBySymbolId.set(
        symbol.id,
        wasModuleOnly && isEvaluatedAtModuleScope(candidate),
      );
    });
  }
  const processLifetimeSymbolIds = new Set<number>();
  for (const [symbolId, isModuleOnly] of instantiationScopeBySymbolId) {
    if (isModuleOnly) processLifetimeSymbolIds.add(symbolId);
  }
  processLifetimeClassSymbolIdsByAnalysis.set(scopes, processLifetimeSymbolIds);
  return processLifetimeSymbolIds;
};

const isProcessLifetimeWiring = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (!isFunctionLike(ancestor)) {
      ancestor = ancestor.parent ?? null;
      continue;
    }
    const functionName = getFunctionName(ancestor);
    if (
      functionName &&
      PROCESS_LIFETIME_WIRING_NAME_PATTERN.test(functionName) &&
      isModuleScopedFunction(ancestor)
    ) {
      const calls = getDirectCalls(ancestor, scopes);
      return calls.length > 0 && calls.every(isEvaluatedAtModuleScope);
    }
    const methodDefinition = ancestor.parent;
    if (
      isNodeOfType(methodDefinition, "MethodDefinition") &&
      methodDefinition.kind === "constructor"
    ) {
      let classNode = methodDefinition.parent?.parent;
      if (
        isNodeOfType(classNode, "ClassDeclaration") ||
        isNodeOfType(classNode, "ClassExpression")
      ) {
        const classRoot = findTransparentExpressionRoot(classNode);
        const classInstantiation = classRoot.parent;
        if (
          isNodeOfType(classNode, "ClassExpression") &&
          isNodeOfType(classInstantiation, "NewExpression") &&
          stripParenExpression(classInstantiation.callee) === classRoot
        ) {
          return isEvaluatedAtModuleScope(classInstantiation);
        }
        const classSymbol = getClassBindingSymbol(classNode, scopes);
        return Boolean(
          classSymbol && getProcessLifetimeClassSymbolIds(node, scopes).has(classSymbol.id),
        );
      }
    }
    return false;
  }
  return false;
};

const mayCarryAbortSignal = (
  optionsArgument: EsTreeNode | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (!optionsArgument) return false;
  const options = resolveStableOptionsObject(optionsArgument, ["signal"], scopes);
  if (!options) return true;
  return options.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null) return true;
    if (propertyName !== "signal") return false;
    const value = property.value;
    if (isNodeOfType(value, "Identifier") && value.name === "undefined") return false;
    if (isNodeOfType(value, "Literal") && value.value == null) return false;
    return !(isNodeOfType(value, "UnaryExpression") && value.operator === "void");
  });
};

const callbackDisposesReaction = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  subscriptionName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const callbackArgument = callExpression.arguments[REACTION_CALLBACK_INDEX[subscriptionName]];
  if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return false;
  const callback = resolveExactLocalFunction(callbackArgument, scopes);
  if (!callback || !isFunctionLike(callback)) return false;
  const reactionParameter = callback.params?.[REACTION_PARAMETER_INDEX[subscriptionName]];
  if (!reactionParameter || !isNodeOfType(reactionParameter, "Identifier")) return false;
  const reactionSymbol = scopes.symbolFor(reactionParameter);
  if (!reactionSymbol) return false;
  let doesDisposeReaction = false;
  walkAst(callback, (candidate) => {
    if (doesDisposeReaction || !isNodeOfType(candidate, "CallExpression")) return;
    const callee = stripParenExpression(candidate.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    const receiver = stripParenExpression(callee.object);
    if (
      isNodeOfType(receiver, "Identifier") &&
      scopes.symbolFor(receiver)?.id === reactionSymbol.id &&
      getStaticPropertyKeyName(callee, { allowComputedString: true }) === "dispose"
    ) {
      doesDisposeReaction = true;
    }
  });
  return doesDisposeReaction;
};

const getMemberReceiverRoot = (memberExpression: EsTreeNode): EsTreeNode => {
  let receiver = stripParenExpression(memberExpression);
  while (isNodeOfType(receiver, "MemberExpression")) {
    receiver = stripParenExpression(receiver.object);
  }
  return receiver;
};

const observesOnlyInstanceRootedState = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  subscriptionName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const callbackArgument = callExpression.arguments[OBSERVATION_CALLBACK_INDEX[subscriptionName]];
  if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return false;
  const callback = resolveExactLocalFunction(callbackArgument, scopes);
  if (!callback || !isFunctionLike(callback)) return false;
  let observesExternalState = false;
  walkAst(callback, (candidate) => {
    if (candidate !== callback && isFunctionLike(candidate)) return false;
    if (observesExternalState || !isNodeOfType(candidate, "MemberExpression")) return;
    const receiver = getMemberReceiverRoot(candidate);
    const candidateRoot = findTransparentExpressionRoot(candidate);
    const parent = candidateRoot.parent;
    const isDirectMethodCall =
      isNodeOfType(parent, "CallExpression") && parent.callee === candidateRoot;
    if (isNodeOfType(receiver, "ThisExpression")) {
      if (isDirectMethodCall) observesExternalState = true;
      return;
    }
    if (!isNodeOfType(receiver, "Identifier")) {
      observesExternalState = true;
      return;
    }
    const receiverSymbol = scopes.symbolFor(receiver);
    if (
      (receiverSymbol && isAstDescendant(receiverSymbol.declarationNode, callback)) ||
      (scopes.isGlobalReference(receiver) &&
        NON_OBSERVABLE_GLOBAL_RECEIVER_NAMES.has(receiver.name))
    ) {
      return;
    }
    if (
      receiverSymbol?.kind === "import" &&
      isDirectMethodCall &&
      NON_OBSERVING_IMPORTED_METHOD_NAMES.has(
        getStaticPropertyKeyName(candidate, { allowComputedString: true }) ?? "",
      )
    ) {
      return;
    }
    observesExternalState = true;
  });
  return !observesExternalState;
};

const isForwardedFromConciseArrow = (callExpression: EsTreeNode): boolean => {
  let expressionRoot = findTransparentExpressionRoot(callExpression);
  let parent = expressionRoot.parent;
  while (parent) {
    if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === expressionRoot) {
      return true;
    }
    if (
      (isNodeOfType(parent, "LogicalExpression") &&
        (parent.right === expressionRoot ||
          (parent.left === expressionRoot && parent.operator !== "&&"))) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === expressionRoot || parent.alternate === expressionRoot)) ||
      (isNodeOfType(parent, "SequenceExpression") &&
        parent.expressions[parent.expressions.length - 1] === expressionRoot)
    ) {
      expressionRoot = findTransparentExpressionRoot(parent);
      parent = expressionRoot.parent;
      continue;
    }
    return false;
  }
  return false;
};

const isDisposerDiscarded = (callExpression: EsTreeNode): boolean => {
  if (isForwardedFromConciseArrow(callExpression)) return false;
  const expressionRoot = findTransparentExpressionRoot(callExpression);
  if (isResultDiscardedCall(callExpression)) return true;
  const parent = expressionRoot.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "UnaryExpression") || isNodeOfType(parent, "BinaryExpression")) {
    return true;
  }
  if (
    (isNodeOfType(parent, "IfStatement") ||
      isNodeOfType(parent, "WhileStatement") ||
      isNodeOfType(parent, "DoWhileStatement") ||
      isNodeOfType(parent, "ForStatement")) &&
    parent.test === expressionRoot
  ) {
    return true;
  }
  if (
    (isNodeOfType(parent, "ConditionalExpression") && parent.test === expressionRoot) ||
    (isNodeOfType(parent, "SwitchStatement") && parent.discriminant === expressionRoot)
  ) {
    return true;
  }
  if (isNodeOfType(parent, "LogicalExpression") && parent.left === expressionRoot) {
    return parent.operator === "&&" || isResultDiscardedCall(parent);
  }
  const callee = isNodeOfType(parent, "CallExpression")
    ? stripParenExpression(parent.callee)
    : null;
  return Boolean(
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments.some((argument) => argument === expressionRoot) &&
    isNodeOfType(callee, "Identifier") &&
    DISPOSER_COERCION_NAMES.has(callee.name),
  );
};

export const mobxReactionDisposerDiscarded = defineRule({
  id: "mobx-reaction-disposer-discarded",
  title: "MobX reaction disposer discarded",
  severity: "warn",
  category: "Bugs",
  requires: MOBX_RULE_GATES["mobx-reaction-disposer-discarded"].requires,
  recommendation:
    "Keep the disposer returned by `reaction` or `autorun` and invoke it during teardown, or provide an AbortSignal.",
  create: (context: RuleContext) => ({
    CallExpression(callExpression: EsTreeNodeOfType<"CallExpression">) {
      const subscriptionName = resolveLeakingSubscriptionName(callExpression, context.scopes);
      if (!subscriptionName || !isDisposerDiscarded(callExpression)) return;
      if (isEvaluatedAtModuleScope(callExpression)) return;
      if (isProcessLifetimeWiring(callExpression, context.scopes)) return;
      if (callbackDisposesReaction(callExpression, subscriptionName, context.scopes)) return;
      if (observesOnlyInstanceRootedState(callExpression, subscriptionName, context.scopes)) return;
      const optionsArgument = callExpression.arguments[OPTIONS_ARGUMENT_INDEX[subscriptionName]];
      if (mayCarryAbortSignal(optionsArgument, context.scopes)) return;
      context.report({ node: callExpression, message: MESSAGE });
    },
  }),
});
