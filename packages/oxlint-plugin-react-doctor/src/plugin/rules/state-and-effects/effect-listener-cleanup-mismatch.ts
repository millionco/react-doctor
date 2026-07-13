import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { buildListenerCleanupMismatchMessage } from "./utils/build-listener-cleanup-mismatch-message.js";
import { callbackMayRegisterEventListener } from "./utils/callback-may-register-event-listener.js";
import { compareListenerCallbackIdentities } from "./utils/compare-listener-callback-identities.js";
import { doesListenerAnalysisAbortController } from "./utils/does-listener-analysis-abort-controller.js";
import { doesListenerAnalysisCancelRegistration } from "./utils/does-listener-analysis-cancel-registration.js";
import { getStaticMemberPropertyName } from "./utils/static-member-property-name.js";
import { isListenerPathAmbiguous } from "./utils/is-listener-path-ambiguous.js";
import { resolveEventListenerCapture } from "./utils/resolve-event-listener-capture.js";
import { resolveStaticOnceOption } from "./utils/resolve-static-once-option.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface CallbackIdentity {
  readonly node: EsTreeNode;
  readonly isConcreteFunction: boolean;
}

interface ListenerCandidate {
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly targetKey: string;
  readonly eventName: string;
  readonly callbackIdentity: CallbackIdentity | null;
  readonly capture: boolean | null;
}

interface ListenerRegistration {
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly targetKey: string;
  readonly eventName: string;
  readonly callbackIdentity: CallbackIdentity;
  readonly capture: boolean;
  readonly once: boolean;
  readonly abortControllerSymbolId: number | null;
  readonly hasUnknownCancellation: boolean;
}

interface CancellationAnalysis {
  readonly removals: ListenerCandidate[];
  readonly abortedControllerSymbolIds: ReadonlySet<number>;
  readonly exhaustiveBranches: ReadonlyArray<ExhaustiveCleanupBranches>;
  readonly hasUnknownAbortCall: boolean;
  readonly hasUnknownRemovalCall: boolean;
}

interface ListenerAnalysis extends CancellationAnalysis {
  readonly registrations: ListenerRegistration[];
  readonly setupAbortAnalysis: CancellationAnalysis | null;
}

interface ListenerMismatch {
  readonly removalNode: EsTreeNodeOfType<"CallExpression">;
  readonly removalCapture: boolean;
  readonly callbackComparison: "different" | "same";
}

interface ExhaustiveCleanupBranches {
  readonly alternate: CancellationAnalysis;
  readonly consequent: CancellationAnalysis;
}

interface EffectListenerInputs {
  readonly registrations: ListenerRegistration[];
  readonly cleanupBodies: EsTreeNode[];
  readonly hasCanonicalCleanupReturn: boolean;
  readonly returnStatementCount: number;
}

interface RegistrationCancellation {
  readonly abortControllerSymbolId: number | null;
  readonly hasUnknownCancellation: boolean;
}

interface CalledCleanup {
  readonly body: EsTreeNode;
  readonly symbolId: number;
}

interface StaticEventDispatch {
  readonly eventName: string;
  readonly targetKey: string;
}

const LISTENER_EFFECT_HOOK_NAMES = new Set([...EFFECT_HOOK_NAMES, "useInsertionEffect"]);

const hasOnlyReadReferences = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => reference.flag === "read");

const isStableSymbol = (symbol: SymbolDescriptor): boolean =>
  symbol.kind === "const" ||
  symbol.kind === "import" ||
  ((symbol.kind === "function" || symbol.kind === "parameter") && hasOnlyReadReferences(symbol));

const isPlainConstSymbol = (symbol: SymbolDescriptor): boolean =>
  symbol.kind === "const" &&
  isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
  isNodeOfType(symbol.declarationNode.id, "Identifier") &&
  symbol.declarationNode.id === symbol.bindingIdentifier;

const resolveAliasedSymbol = (
  identifier: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number>,
): SymbolDescriptor | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol || !isStableSymbol(symbol) || visitedSymbolIds.has(symbol.id)) return null;
  if (symbol.kind === "const" && !isPlainConstSymbol(symbol)) return null;
  visitedSymbolIds.add(symbol.id);
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  if (symbol.kind === "const" && isNodeOfType(initializer, "Identifier")) {
    const resolvedAlias = resolveAliasedSymbol(initializer, context, visitedSymbolIds);
    if (resolvedAlias) return resolvedAlias;
  }
  return symbol;
};

const resolveCallbackIdentity = (
  callbackNode: EsTreeNode | null | undefined,
  context: RuleContext,
): CallbackIdentity | null => {
  if (!callbackNode) return null;
  const unwrappedCallback = stripParenExpression(callbackNode);
  if (isFunctionLike(unwrappedCallback)) {
    return { node: unwrappedCallback, isConcreteFunction: true };
  }
  if (!isNodeOfType(unwrappedCallback, "Identifier")) return null;

  const symbol = resolveAliasedSymbol(unwrappedCallback, context, new Set());
  if (!symbol) return null;
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  if (initializer && isFunctionLike(initializer)) {
    return { node: initializer, isConcreteFunction: true };
  }
  return { node: symbol.bindingIdentifier, isConcreteFunction: false };
};

const resolveTargetKey = (targetNode: EsTreeNode, context: RuleContext): string | null => {
  const unwrappedTarget = stripParenExpression(targetNode);
  if (isNodeOfType(unwrappedTarget, "Identifier")) {
    const symbol = resolveAliasedSymbol(unwrappedTarget, context, new Set());
    if (symbol) {
      if (symbol.kind === "import" || symbol.kind === "parameter" || symbol.kind === "function") {
        return null;
      }
      const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
      if (
        isNodeOfType(initializer, "NewExpression") &&
        isNodeOfType(initializer.callee, "Identifier") &&
        !context.scopes.isGlobalReference(initializer.callee)
      ) {
        return null;
      }
      if (isNodeOfType(initializer, "NewExpression")) return `fresh:${symbol.id}`;
      return `symbol:${symbol.id}`;
    }
    if (context.scopes.isGlobalReference(unwrappedTarget)) {
      return `global:${unwrappedTarget.name}`;
    }
    return null;
  }
  if (
    isNodeOfType(unwrappedTarget, "MemberExpression") &&
    !unwrappedTarget.computed &&
    isNodeOfType(unwrappedTarget.property, "Identifier")
  ) {
    const objectKey = resolveTargetKey(unwrappedTarget.object, context);
    if (
      unwrappedTarget.property.name === "document" &&
      (objectKey === "global:window" || objectKey === "global:globalThis")
    ) {
      return "global:document";
    }
    if (
      unwrappedTarget.property.name === "window" &&
      (objectKey === "global:window" || objectKey === "global:globalThis")
    ) {
      return "global:window";
    }
    return objectKey === null ? null : `${objectKey}.${unwrappedTarget.property.name}`;
  }
  return null;
};

const resolveStaticEventName = (
  eventNode: EsTreeNode | null | undefined,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  if (!eventNode) return null;
  const unwrappedEvent = stripParenExpression(eventNode);
  if (isNodeOfType(unwrappedEvent, "Literal") && typeof unwrappedEvent.value === "string") {
    return unwrappedEvent.value;
  }
  if (isNodeOfType(unwrappedEvent, "TemplateLiteral") && unwrappedEvent.expressions.length === 0) {
    return unwrappedEvent.quasis[0]?.value.cooked ?? "";
  }
  if (!isNodeOfType(unwrappedEvent, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(unwrappedEvent);
  if (
    !symbol ||
    !isPlainConstSymbol(symbol) ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id)
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  return resolveStaticEventName(symbol.initializer, context, visitedSymbolIds);
};

const readStaticEventDispatch = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): StaticEventDispatch | null => {
  const targetNode = readDirectMemberReceiver(node.callee, "dispatchEvent", context);
  const eventArgument = node.arguments?.[0];
  if (!eventArgument) return null;
  const eventNode = stripParenExpression(eventArgument);
  if (
    !targetNode ||
    !isNodeOfType(eventNode, "NewExpression") ||
    !isNodeOfType(eventNode.callee, "Identifier") ||
    eventNode.callee.name !== "Event" ||
    !context.scopes.isGlobalReference(eventNode.callee)
  ) {
    return null;
  }
  const target = stripParenExpression(targetNode);
  if (!isNodeOfType(target, "Identifier")) return null;
  const targetSymbol = resolveAliasedSymbol(target, context, new Set());
  const targetInitializer = targetSymbol?.initializer
    ? stripParenExpression(targetSymbol.initializer)
    : null;
  if (
    !isNodeOfType(targetInitializer, "NewExpression") ||
    !isNodeOfType(targetInitializer.callee, "Identifier") ||
    targetInitializer.callee.name !== "EventTarget" ||
    !context.scopes.isGlobalReference(targetInitializer.callee)
  ) {
    return null;
  }
  const targetKey = resolveTargetKey(targetNode, context);
  const eventName = resolveStaticEventName(eventNode.arguments?.[0], context);
  return targetKey !== null && eventName !== null ? { eventName, targetKey } : null;
};

const resolveLocalAbortControllerSymbolId = (
  controllerNode: EsTreeNode,
  context: RuleContext,
): number | null => {
  const unwrappedController = stripParenExpression(controllerNode);
  if (!isNodeOfType(unwrappedController, "Identifier")) return null;
  const controllerSymbol = resolveAliasedSymbol(unwrappedController, context, new Set());
  if (!controllerSymbol || controllerSymbol.kind !== "const" || !controllerSymbol.initializer) {
    return null;
  }
  const initializer = stripParenExpression(controllerSymbol.initializer);
  if (
    !isNodeOfType(initializer, "NewExpression") ||
    !isNodeOfType(initializer.callee, "Identifier") ||
    initializer.callee.name !== "AbortController" ||
    !context.scopes.isGlobalReference(initializer.callee)
  ) {
    return null;
  }
  return controllerSymbol.id;
};

const readDirectMemberReceiver = (
  memberNode: EsTreeNode | null | undefined,
  memberName: string,
  context?: RuleContext,
): EsTreeNode | null => {
  if (!memberNode) return null;
  const unwrappedMember = stripParenExpression(memberNode);
  if (!isNodeOfType(unwrappedMember, "MemberExpression")) return null;
  const staticPropertyName =
    getStaticMemberPropertyName(unwrappedMember) ??
    (context && unwrappedMember.computed
      ? resolveStaticEventName(unwrappedMember.property, context)
      : null);
  if (staticPropertyName !== memberName) return null;
  return unwrappedMember.object;
};

const isSignalObjectPatternBinding = (
  patternNode: EsTreeNode,
  bindingIdentifier: EsTreeNode,
): boolean => {
  if (!isNodeOfType(patternNode, "ObjectPattern")) return false;
  return patternNode.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return false;
    if (getStaticPropertyKeyName(property, { allowComputedString: true }) !== "signal") {
      return false;
    }
    const propertyValue = isNodeOfType(property.value, "AssignmentPattern")
      ? property.value.left
      : property.value;
    return propertyValue === bindingIdentifier;
  });
};

const resolveSignalAbortControllerSymbolId = (
  signalNode: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): number | null => {
  const unwrappedSignal = stripParenExpression(signalNode);
  const directControllerNode = readDirectMemberReceiver(unwrappedSignal, "signal");
  if (directControllerNode) {
    return resolveLocalAbortControllerSymbolId(directControllerNode, context);
  }
  if (!isNodeOfType(unwrappedSignal, "Identifier")) return null;
  const signalSymbol = context.scopes.symbolFor(unwrappedSignal);
  if (
    !signalSymbol ||
    signalSymbol.kind !== "const" ||
    !signalSymbol.initializer ||
    visitedSymbolIds.has(signalSymbol.id) ||
    !hasOnlyReadReferences(signalSymbol)
  ) {
    return null;
  }
  visitedSymbolIds.add(signalSymbol.id);
  const declarationNode = signalSymbol.declarationNode;
  if (!isNodeOfType(declarationNode, "VariableDeclarator")) return null;
  if (
    isNodeOfType(declarationNode.id, "Identifier") &&
    declarationNode.id === signalSymbol.bindingIdentifier
  ) {
    const initializer = stripParenExpression(signalSymbol.initializer);
    if (isNodeOfType(initializer, "Identifier")) {
      return resolveSignalAbortControllerSymbolId(initializer, context, visitedSymbolIds);
    }
    const controllerNode = readDirectMemberReceiver(initializer, "signal");
    return controllerNode ? resolveLocalAbortControllerSymbolId(controllerNode, context) : null;
  }
  if (!isSignalObjectPatternBinding(declarationNode.id, signalSymbol.bindingIdentifier)) {
    return null;
  }
  return resolveLocalAbortControllerSymbolId(signalSymbol.initializer, context);
};

const readControllerAbortedCondition = (
  conditionNode: EsTreeNode,
  controllerSymbolId: number,
  context: RuleContext,
): "aborted" | "not-aborted" | null => {
  const unwrappedCondition = stripParenExpression(conditionNode);
  if (isNodeOfType(unwrappedCondition, "UnaryExpression") && unwrappedCondition.operator === "!") {
    const operandCondition = readControllerAbortedCondition(
      unwrappedCondition.argument,
      controllerSymbolId,
      context,
    );
    if (operandCondition === "aborted") return "not-aborted";
    if (operandCondition === "not-aborted") return "aborted";
    return null;
  }
  if (isNodeOfType(unwrappedCondition, "BinaryExpression")) {
    const leftBoolean = readStaticBoolean(unwrappedCondition.left);
    const rightBoolean = readStaticBoolean(unwrappedCondition.right);
    const memberNode =
      leftBoolean === null
        ? unwrappedCondition.left
        : rightBoolean === null
          ? unwrappedCondition.right
          : null;
    const comparedBoolean = leftBoolean ?? rightBoolean;
    if (memberNode && comparedBoolean !== null) {
      const memberCondition = readControllerAbortedCondition(
        memberNode,
        controllerSymbolId,
        context,
      );
      if (memberCondition) {
        const isEquality =
          unwrappedCondition.operator === "==" || unwrappedCondition.operator === "===";
        const isInequality =
          unwrappedCondition.operator === "!=" || unwrappedCondition.operator === "!==";
        const shouldInvert = (isEquality && !comparedBoolean) || (isInequality && comparedBoolean);
        if (isEquality || isInequality) {
          if (!shouldInvert) return memberCondition;
          return memberCondition === "aborted" ? "not-aborted" : "aborted";
        }
      }
    }
    return null;
  }
  const signalNode = readDirectMemberReceiver(unwrappedCondition, "aborted");
  if (!signalNode) return null;
  return resolveSignalAbortControllerSymbolId(signalNode, context) === controllerSymbolId
    ? "aborted"
    : null;
};

const isAbortGuardForChild = (
  parentNode: EsTreeNode,
  childNode: EsTreeNode,
  controllerSymbolId: number,
  context: RuleContext,
): boolean => {
  if (
    isNodeOfType(parentNode, "IfStatement") ||
    isNodeOfType(parentNode, "ConditionalExpression")
  ) {
    const condition = readControllerAbortedCondition(parentNode.test, controllerSymbolId, context);
    return (
      (parentNode.consequent === childNode && condition === "not-aborted") ||
      (parentNode.alternate === childNode && condition === "aborted")
    );
  }
  if (!isNodeOfType(parentNode, "LogicalExpression") || parentNode.right !== childNode) {
    return false;
  }
  const condition = readControllerAbortedCondition(parentNode.left, controllerSymbolId, context);
  return (
    (parentNode.operator === "&&" && condition === "not-aborted") ||
    (parentNode.operator === "||" && condition === "aborted")
  );
};

const isAbortGuaranteedByPath = (
  node: EsTreeNode,
  bodyNode: EsTreeNode,
  controllerSymbolId: number,
  context: RuleContext,
): boolean =>
  !isListenerPathAmbiguous(node, bodyNode, (parentNode, childNode) =>
    isAbortGuardForChild(parentNode, childNode, controllerSymbolId, context),
  );

const resolveBoundAbortControllerSymbolId = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): number | null => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const boundAbortSymbol = resolveAliasedSymbol(callee, context, new Set());
  if (!boundAbortSymbol?.initializer) return null;
  const initializer = stripParenExpression(boundAbortSymbol.initializer);
  if (!isNodeOfType(initializer, "CallExpression")) return null;
  const abortMethodNode = readDirectMemberReceiver(initializer.callee, "bind");
  if (!abortMethodNode) return null;
  const controllerNode = readDirectMemberReceiver(abortMethodNode, "abort");
  const boundThisNode = initializer.arguments?.[0];
  if (!controllerNode || !boundThisNode) return null;
  const controllerSymbolId = resolveLocalAbortControllerSymbolId(controllerNode, context);
  const boundThisSymbolId = resolveLocalAbortControllerSymbolId(boundThisNode, context);
  return controllerSymbolId !== null && controllerSymbolId === boundThisSymbolId
    ? controllerSymbolId
    : null;
};

const resolveRegistrationCancellation = (
  optionsNode: EsTreeNode | null | undefined,
  context: RuleContext,
): RegistrationCancellation => {
  const noCancellation: RegistrationCancellation = {
    abortControllerSymbolId: null,
    hasUnknownCancellation: false,
  };
  if (!optionsNode) return noCancellation;
  const unwrappedOptions = stripParenExpression(optionsNode);
  if (!isNodeOfType(unwrappedOptions, "ObjectExpression")) return noCancellation;
  let resolvedCancellation: RegistrationCancellation | null = null;
  for (const property of unwrappedOptions.properties) {
    if (!isNodeOfType(property, "Property")) return noCancellation;
    if (getStaticPropertyKeyName(property, { allowComputedString: true }) !== "signal") continue;
    if (resolvedCancellation) {
      return { abortControllerSymbolId: null, hasUnknownCancellation: true };
    }
    const abortControllerSymbolId = resolveSignalAbortControllerSymbolId(property.value, context);
    resolvedCancellation = {
      abortControllerSymbolId,
      hasUnknownCancellation: abortControllerSymbolId === null,
    };
  }
  return resolvedCancellation ?? noCancellation;
};

const readListenerCandidate = (
  node: EsTreeNodeOfType<"CallExpression">,
  methodName: "addEventListener" | "removeEventListener",
  context: RuleContext,
): ListenerCandidate | null => {
  const targetNode = readDirectMemberReceiver(node.callee, methodName, context);
  if (!targetNode) return null;
  const targetKey = resolveTargetKey(targetNode, context);
  const eventName = resolveStaticEventName(node.arguments?.[0], context);
  const callbackIdentity = resolveCallbackIdentity(node.arguments?.[1], context);
  const capture = resolveEventListenerCapture(node.arguments?.[2], { allowComputedString: true });
  if (targetKey === null || eventName === null) return null;
  return { node, targetKey, eventName, callbackIdentity, capture };
};

const readDestructuredRemovalCandidate = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): ListenerCandidate | null => {
  const methodNode = readDirectMemberReceiver(node.callee, "call");
  if (!methodNode || !isNodeOfType(methodNode, "Identifier")) return null;
  const methodSymbol = context.scopes.symbolFor(methodNode);
  if (
    !methodSymbol ||
    methodSymbol.kind !== "const" ||
    !hasOnlyReadReferences(methodSymbol) ||
    !isNodeOfType(methodSymbol.declarationNode, "VariableDeclarator")
  ) {
    return null;
  }
  const declaration = methodSymbol.declarationNode;
  if (!isNodeOfType(declaration.id, "ObjectPattern") || !declaration.init) return null;
  const isRemovalBinding = declaration.id.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return false;
    const bindingNode = isNodeOfType(property.value, "AssignmentPattern")
      ? property.value.left
      : property.value;
    return (
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "removeEventListener" &&
      bindingNode === methodSymbol.bindingIdentifier
    );
  });
  if (!isRemovalBinding) return null;
  const targetNode = node.arguments?.[0];
  if (!targetNode) return null;
  const declarationTargetKey = resolveTargetKey(declaration.init, context);
  const targetKey = resolveTargetKey(targetNode, context);
  if (declarationTargetKey === null || targetKey === null || declarationTargetKey !== targetKey) {
    return null;
  }
  const eventName = resolveStaticEventName(node.arguments?.[1], context);
  if (eventName === null) return null;
  return {
    node,
    targetKey,
    eventName,
    callbackIdentity: resolveCallbackIdentity(node.arguments?.[2], context),
    capture: resolveEventListenerCapture(node.arguments?.[3], { allowComputedString: true }),
  };
};

const resolveReturnedCleanupBody = (
  returnedValue: EsTreeNode | null | undefined,
  context: RuleContext,
): EsTreeNode | null => {
  if (!returnedValue) return null;
  const unwrappedValue = stripParenExpression(returnedValue);
  if (isFunctionLike(unwrappedValue)) return unwrappedValue.body;
  if (!isNodeOfType(unwrappedValue, "Identifier")) return null;
  const symbol = resolveAliasedSymbol(unwrappedValue, context, new Set());
  if (!symbol || !symbol.initializer) return null;
  const initializer = stripParenExpression(symbol.initializer);
  return isFunctionLike(initializer) ? initializer.body : null;
};

const collectEffectListenerInputs = (
  effectBody: EsTreeNode,
  context: RuleContext,
): EffectListenerInputs => {
  const registrations: ListenerRegistration[] = [];
  const cleanupBodies: EsTreeNode[] = [];
  const listenerRegistrationCountsByTarget = new Map<string, number>();
  let returnStatementCount = 0;
  if (!isNodeOfType(effectBody, "BlockStatement")) {
    return {
      registrations,
      cleanupBodies,
      hasCanonicalCleanupReturn: false,
      returnStatementCount,
    };
  }
  const finalEffectStatement = effectBody.body[effectBody.body.length - 1];
  const hasCanonicalCleanupReturn = isNodeOfType(finalEffectStatement, "ReturnStatement");
  walkAst(effectBody, (child: EsTreeNode) => {
    if (child !== effectBody && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ClassDeclaration") || isNodeOfType(child, "ClassExpression")) {
      return false;
    }
    if (isNodeOfType(child, "CallExpression")) {
      const hasAmbiguousPath = isListenerPathAmbiguous(child, effectBody);
      if (hasAmbiguousPath) return;
      const registrationTarget = readDirectMemberReceiver(
        child.callee,
        "addEventListener",
        context,
      );
      const registrationTargetKey = registrationTarget
        ? resolveTargetKey(registrationTarget, context)
        : null;
      if (registrationTargetKey !== null) {
        listenerRegistrationCountsByTarget.set(
          registrationTargetKey,
          (listenerRegistrationCountsByTarget.get(registrationTargetKey) ?? 0) + 1,
        );
      }
      const candidate = readListenerCandidate(child, "addEventListener", context);
      if (candidate?.callbackIdentity && candidate.capture !== null) {
        const registrationCancellation = resolveRegistrationCancellation(
          candidate.node.arguments?.[2],
          context,
        );
        registrations.push({
          node: candidate.node,
          targetKey: candidate.targetKey,
          eventName: candidate.eventName,
          callbackIdentity: candidate.callbackIdentity,
          capture: candidate.capture,
          once: resolveStaticOnceOption(candidate.node.arguments?.[2]) === true,
          abortControllerSymbolId: registrationCancellation.abortControllerSymbolId,
          hasUnknownCancellation: registrationCancellation.hasUnknownCancellation,
        });
      }
      const eventDispatch = readStaticEventDispatch(child, context);
      if (eventDispatch) {
        const dispatchedRegistrations = registrations.filter(
          (registration) =>
            registration.targetKey === eventDispatch.targetKey &&
            registration.eventName === eventDispatch.eventName,
        );
        const dispatchedRegistration = dispatchedRegistrations[0];
        if (
          dispatchedRegistrations.length === 1 &&
          dispatchedRegistration?.once &&
          listenerRegistrationCountsByTarget.get(eventDispatch.targetKey) === 1 &&
          dispatchedRegistration.callbackIdentity.isConcreteFunction &&
          !callbackMayRegisterEventListener(dispatchedRegistration.callbackIdentity.node)
        ) {
          registrations.splice(registrations.indexOf(dispatchedRegistration), 1);
        }
      }
      return;
    }
    if (isNodeOfType(child, "ReturnStatement")) {
      returnStatementCount += 1;
      const cleanupBody = resolveReturnedCleanupBody(child.argument, context);
      if (cleanupBody) cleanupBodies.push(cleanupBody);
    }
  });
  return {
    registrations,
    cleanupBodies,
    hasCanonicalCleanupReturn,
    returnStatementCount,
  };
};

const resolveCalledCleanup = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): CalledCleanup | null => {
  const callee = stripParenExpression(callNode.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const cleanupSymbol = resolveAliasedSymbol(callee, context, new Set());
  if (
    !cleanupSymbol?.initializer ||
    (cleanupSymbol.kind !== "const" && cleanupSymbol.kind !== "function")
  ) {
    return null;
  }
  const initializer = stripParenExpression(cleanupSymbol.initializer);
  if (!isFunctionLike(initializer) || initializer.async || initializer.generator) return null;
  return { body: initializer.body, symbolId: cleanupSymbol.id };
};

const analyzeCleanupBody = (
  cleanupBody: EsTreeNode,
  context: RuleContext,
  visitedCleanupSymbolIds: Set<number> = new Set(),
  isLoopBody = false,
): CancellationAnalysis | null => {
  const removals: ListenerCandidate[] = [];
  const abortedControllerSymbolIds = new Set<number>();
  const exhaustiveBranches: ExhaustiveCleanupBranches[] = [];
  let hasAmbiguousReachability = false;
  let hasUnknownAbortCall = false;
  let hasUnknownRemovalCall = false;
  const finalCleanupStatement = isNodeOfType(cleanupBody, "BlockStatement")
    ? cleanupBody.body[cleanupBody.body.length - 1]
    : null;
  const addCleanupAnalysis = (analysis: CancellationAnalysis): void => {
    removals.push(...analysis.removals);
    hasUnknownAbortCall ||= analysis.hasUnknownAbortCall;
    hasUnknownRemovalCall ||= analysis.hasUnknownRemovalCall;
    for (const controllerSymbolId of analysis.abortedControllerSymbolIds) {
      abortedControllerSymbolIds.add(controllerSymbolId);
    }
    exhaustiveBranches.push(...analysis.exhaustiveBranches);
  };
  const addGuaranteedLoopPrefix = (loopBody: EsTreeNode): boolean => {
    const loopStatements = isNodeOfType(loopBody, "BlockStatement") ? loopBody.body : [loopBody];
    for (const loopStatement of loopStatements) {
      if (
        isNodeOfType(loopStatement, "BreakStatement") ||
        isNodeOfType(loopStatement, "ContinueStatement")
      ) {
        return true;
      }
      if (isNodeOfType(loopStatement, "BlockStatement")) {
        if (addGuaranteedLoopPrefix(loopStatement)) return true;
        continue;
      }
      if (isNodeOfType(loopStatement, "IfStatement")) {
        const staticTestValue = readStaticBoolean(loopStatement.test);
        if (staticTestValue !== null) {
          const testAnalysis = analyzeCleanupBody(
            loopStatement.test,
            context,
            new Set(visitedCleanupSymbolIds),
            true,
          );
          if (!testAnalysis) return true;
          addCleanupAnalysis(testAnalysis);
          const guaranteedBranch = staticTestValue
            ? loopStatement.consequent
            : loopStatement.alternate;
          if (guaranteedBranch && addGuaranteedLoopPrefix(guaranteedBranch)) return true;
          continue;
        }
      }
      const loopStatementAnalysis = analyzeCleanupBody(
        loopStatement,
        context,
        new Set(visitedCleanupSymbolIds),
        true,
      );
      if (!loopStatementAnalysis) return true;
      addCleanupAnalysis(loopStatementAnalysis);
    }
    return false;
  };
  walkAst(cleanupBody, (child: EsTreeNode) => {
    if (child !== cleanupBody && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ClassDeclaration") || isNodeOfType(child, "ClassExpression")) {
      return false;
    }
    if (isNodeOfType(child, "ReturnStatement") && child === finalCleanupStatement) {
      return;
    }
    if (
      isNodeOfType(child, "ReturnStatement") ||
      isNodeOfType(child, "ThrowStatement") ||
      (isLoopBody &&
        (isNodeOfType(child, "BreakStatement") || isNodeOfType(child, "ContinueStatement")))
    ) {
      hasAmbiguousReachability = true;
      return false;
    }
    if (isNodeOfType(child, "ForOfStatement")) {
      const iterable = stripParenExpression(child.right);
      const isGuaranteedNonEmpty =
        isNodeOfType(iterable, "ArrayExpression") &&
        iterable.elements.some((element) => element && !isNodeOfType(element, "SpreadElement"));
      if (isGuaranteedNonEmpty && !isListenerPathAmbiguous(child, cleanupBody)) {
        addGuaranteedLoopPrefix(child.body);
      }
      return false;
    }
    if (
      (isNodeOfType(child, "IfStatement") || isNodeOfType(child, "ConditionalExpression")) &&
      child.alternate &&
      readStaticBoolean(child.test) === null &&
      !isListenerPathAmbiguous(child, cleanupBody)
    ) {
      const consequentAnalysis = analyzeCleanupBody(
        child.consequent,
        context,
        new Set(visitedCleanupSymbolIds),
      );
      const alternateAnalysis = analyzeCleanupBody(
        child.alternate,
        context,
        new Set(visitedCleanupSymbolIds),
      );
      if (consequentAnalysis && alternateAnalysis) {
        exhaustiveBranches.push({
          alternate: alternateAnalysis,
          consequent: consequentAnalysis,
        });
        hasUnknownAbortCall ||=
          consequentAnalysis.hasUnknownAbortCall && alternateAnalysis.hasUnknownAbortCall;
        hasUnknownRemovalCall ||=
          consequentAnalysis.hasUnknownRemovalCall && alternateAnalysis.hasUnknownRemovalCall;
      }
      const testAnalysis = analyzeCleanupBody(
        child.test,
        context,
        new Set(visitedCleanupSymbolIds),
      );
      if (testAnalysis) addCleanupAnalysis(testAnalysis);
      return false;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    const hasAmbiguousPath = isListenerPathAmbiguous(child, cleanupBody);
    const removalTarget = readDirectMemberReceiver(child.callee, "removeEventListener", context);
    if (removalTarget && !hasAmbiguousPath) {
      const removal = readListenerCandidate(child, "removeEventListener", context);
      if (removal) {
        removals.push(removal);
        hasUnknownRemovalCall ||= removal.callbackIdentity === null || removal.capture === null;
      } else {
        hasUnknownRemovalCall = true;
      }
    }
    if (!removalTarget && !hasAmbiguousPath) {
      const destructuredRemoval = readDestructuredRemovalCandidate(child, context);
      if (destructuredRemoval) removals.push(destructuredRemoval);
    }
    const controllerNode = readDirectMemberReceiver(child.callee, "abort");
    if (controllerNode) {
      const controllerSymbolId = resolveLocalAbortControllerSymbolId(controllerNode, context);
      if (controllerSymbolId === null) {
        if (!hasAmbiguousPath) hasUnknownAbortCall = true;
      } else if (
        !hasAmbiguousPath ||
        isAbortGuaranteedByPath(child, cleanupBody, controllerSymbolId, context)
      ) {
        abortedControllerSymbolIds.add(controllerSymbolId);
      }
      return;
    }
    if (hasAmbiguousPath) return;
    const boundAbortControllerSymbolId = resolveBoundAbortControllerSymbolId(child, context);
    if (boundAbortControllerSymbolId !== null) {
      abortedControllerSymbolIds.add(boundAbortControllerSymbolId);
      return;
    }
    const calledCleanup = resolveCalledCleanup(child, context);
    if (!calledCleanup || visitedCleanupSymbolIds.has(calledCleanup.symbolId)) return;
    visitedCleanupSymbolIds.add(calledCleanup.symbolId);
    const calledCleanupAnalysis = analyzeCleanupBody(
      calledCleanup.body,
      context,
      visitedCleanupSymbolIds,
    );
    if (!calledCleanupAnalysis) return;
    addCleanupAnalysis(calledCleanupAnalysis);
  });
  if (hasAmbiguousReachability) return null;
  return {
    removals,
    abortedControllerSymbolIds,
    exhaustiveBranches,
    hasUnknownAbortCall,
    hasUnknownRemovalCall,
  };
};

const analyzeEffectListeners = (
  effectBody: EsTreeNode,
  context: RuleContext,
): ListenerAnalysis | null => {
  const effectInputs = collectEffectListenerInputs(effectBody, context);
  if (
    !effectInputs.hasCanonicalCleanupReturn ||
    effectInputs.returnStatementCount !== 1 ||
    effectInputs.cleanupBodies.length !== 1
  ) {
    return null;
  }
  const removals: ListenerCandidate[] = [];
  const abortedControllerSymbolIds = new Set<number>();
  const exhaustiveBranches: ExhaustiveCleanupBranches[] = [];
  let hasUnknownAbortCall = false;
  let hasUnknownRemovalCall = false;
  const addAnalysis = (analysis: CancellationAnalysis): void => {
    removals.push(...analysis.removals);
    exhaustiveBranches.push(...analysis.exhaustiveBranches);
    hasUnknownAbortCall ||= analysis.hasUnknownAbortCall;
    hasUnknownRemovalCall ||= analysis.hasUnknownRemovalCall;
    for (const controllerSymbolId of analysis.abortedControllerSymbolIds) {
      abortedControllerSymbolIds.add(controllerSymbolId);
    }
  };
  const setupAbortAnalysis = analyzeCleanupBody(effectBody, context);
  for (const cleanupBody of effectInputs.cleanupBodies) {
    const cleanupAnalysis = analyzeCleanupBody(cleanupBody, context);
    if (!cleanupAnalysis) return null;
    addAnalysis(cleanupAnalysis);
  }
  return {
    registrations: effectInputs.registrations,
    removals,
    abortedControllerSymbolIds,
    exhaustiveBranches,
    hasUnknownAbortCall,
    hasUnknownRemovalCall,
    setupAbortAnalysis,
  };
};

export const effectListenerCleanupMismatch = defineRule({
  id: "effect-listener-cleanup-mismatch",
  title: "Effect cleanup does not match its event listener",
  severity: "error",
  recommendation:
    "Pass the same callback binding and capture flag to `addEventListener` and `removeEventListener`, or abort the registration's local AbortController during cleanup.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactApiCall(node, LISTENER_EFFECT_HOOK_NAMES, context.scopes)) return;
      const effectCallback = getEffectCallback(node);
      if (!isFunctionLike(effectCallback)) return;
      const listenerAnalysis = analyzeEffectListeners(effectCallback.body, context);
      if (!listenerAnalysis) return;

      for (const registration of listenerAnalysis.registrations) {
        if (registration.hasUnknownCancellation || listenerAnalysis.hasUnknownRemovalCall) {
          continue;
        }
        const sameEventRegistrations = listenerAnalysis.registrations.filter(
          (candidateRegistration) =>
            candidateRegistration.targetKey === registration.targetKey &&
            candidateRegistration.eventName === registration.eventName,
        );
        if (sameEventRegistrations.length > 1) continue;
        if (registration.abortControllerSymbolId !== null && listenerAnalysis.hasUnknownAbortCall) {
          continue;
        }
        if (
          registration.abortControllerSymbolId !== null &&
          listenerAnalysis.setupAbortAnalysis &&
          doesListenerAnalysisAbortController(
            listenerAnalysis.setupAbortAnalysis,
            registration.abortControllerSymbolId,
          )
        ) {
          continue;
        }
        if (doesListenerAnalysisCancelRegistration(listenerAnalysis, registration)) continue;
        const candidateRemovals = listenerAnalysis.removals.filter(
          (removal) =>
            removal.targetKey === registration.targetKey &&
            removal.eventName === registration.eventName,
        );
        let firstProvableMismatch: ListenerMismatch | undefined;
        let didFindNonMismatchCandidate = false;
        for (const removal of candidateRemovals) {
          if (!removal.callbackIdentity || removal.capture === null) {
            didFindNonMismatchCandidate = true;
            break;
          }
          const callbackComparison = compareListenerCallbackIdentities(
            registration.callbackIdentity,
            removal.callbackIdentity,
          );
          if (callbackComparison === "unknown") {
            didFindNonMismatchCandidate = true;
            break;
          }
          if (callbackComparison === "same" && registration.capture === removal.capture) {
            didFindNonMismatchCandidate = true;
            break;
          }
          firstProvableMismatch ??= {
            removalNode: removal.node,
            removalCapture: removal.capture,
            callbackComparison,
          };
        }
        if (
          candidateRemovals.length === 0 ||
          didFindNonMismatchCandidate ||
          !firstProvableMismatch
        ) {
          continue;
        }
        context.report({
          node: firstProvableMismatch.removalNode,
          message: buildListenerCleanupMismatchMessage(
            registration.eventName,
            registration.capture,
            firstProvableMismatch.removalCapture,
            firstProvableMismatch.callbackComparison,
          ),
        });
      }
    },
  }),
});
