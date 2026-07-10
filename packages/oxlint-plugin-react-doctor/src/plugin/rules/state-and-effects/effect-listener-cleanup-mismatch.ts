import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getStaticMemberPropertyName } from "./utils/static-member-property-name.js";
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
  readonly abortControllerSymbolId: number | null;
  readonly hasUnknownCancellation: boolean;
}

interface ListenerAnalysis {
  readonly registrations: ListenerRegistration[];
  readonly removals: ListenerCandidate[];
  readonly abortedControllerSymbolIds: ReadonlySet<number>;
  readonly hasUnknownAbortCall: boolean;
  readonly hasUnknownRemovalCall: boolean;
}

interface ListenerMismatch {
  readonly removalNode: EsTreeNodeOfType<"CallExpression">;
  readonly removalCapture: boolean;
  readonly callbackComparison: "different" | "same";
}

interface CleanupAnalysis {
  readonly removals: ListenerCandidate[];
  readonly abortedControllerSymbolIds: ReadonlySet<number>;
  readonly hasUnknownAbortCall: boolean;
  readonly hasUnknownRemovalCall: boolean;
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

const LISTENER_EFFECT_HOOK_NAMES = new Set([...EFFECT_HOOK_NAMES, "useInsertionEffect"]);

const PATH_AMBIGUOUS_ANCESTOR_TYPES: ReadonlySet<string> = new Set([
  "CatchClause",
  "ConditionalExpression",
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "IfStatement",
  "LogicalExpression",
  "SwitchCase",
  "SwitchStatement",
  "TryStatement",
  "WhileStatement",
]);

const isPathAmbiguousCall = (node: EsTreeNode, bodyNode: EsTreeNode): boolean => {
  if (PATH_AMBIGUOUS_ANCESTOR_TYPES.has(bodyNode.type)) return true;
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode?.parent && currentNode.parent !== bodyNode) {
    currentNode = currentNode.parent;
    if (PATH_AMBIGUOUS_ANCESTOR_TYPES.has(currentNode.type)) return true;
  }
  return false;
};

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

const compareCallbackIdentities = (
  registrationIdentity: CallbackIdentity,
  removalIdentity: CallbackIdentity,
): "same" | "different" | "unknown" => {
  if (registrationIdentity.node === removalIdentity.node) return "same";
  if (registrationIdentity.isConcreteFunction && removalIdentity.isConcreteFunction) {
    return "different";
  }
  return "unknown";
};

const resolveTargetKey = (targetNode: EsTreeNode, context: RuleContext): string | null => {
  const unwrappedTarget = stripParenExpression(targetNode);
  if (isNodeOfType(unwrappedTarget, "Identifier")) {
    const symbol = resolveAliasedSymbol(unwrappedTarget, context, new Set());
    if (symbol) return `symbol:${symbol.id}`;
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

const resolveCapture = (optionsNode: EsTreeNode | null | undefined): boolean | null => {
  if (!optionsNode) return false;
  const unwrappedOptions = stripParenExpression(optionsNode);
  if (isNodeOfType(unwrappedOptions, "Literal")) {
    return typeof unwrappedOptions.value === "boolean" ? unwrappedOptions.value : null;
  }
  if (!isNodeOfType(unwrappedOptions, "ObjectExpression")) return null;

  let capture = false;
  for (const property of unwrappedOptions.properties) {
    if (!isNodeOfType(property, "Property")) return null;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null) return null;
    if (propertyName !== "capture") continue;
    const propertyValue = stripParenExpression(property.value);
    if (!isNodeOfType(propertyValue, "Literal") || typeof propertyValue.value !== "boolean") {
      return null;
    }
    capture = propertyValue.value;
  }
  return capture;
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
): EsTreeNode | null => {
  if (!memberNode) return null;
  const unwrappedMember = stripParenExpression(memberNode);
  if (
    !isNodeOfType(unwrappedMember, "MemberExpression") ||
    getStaticMemberPropertyName(unwrappedMember) !== memberName
  ) {
    return null;
  }
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
  const targetNode = readDirectMemberReceiver(node.callee, methodName);
  if (!targetNode) return null;
  const targetKey = resolveTargetKey(targetNode, context);
  const eventName = resolveStaticEventName(node.arguments?.[0], context);
  const callbackIdentity = resolveCallbackIdentity(node.arguments?.[1], context);
  const capture = resolveCapture(node.arguments?.[2]);
  if (targetKey === null || eventName === null) return null;
  return { node, targetKey, eventName, callbackIdentity, capture };
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
      if (isPathAmbiguousCall(child, effectBody)) return;
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
          abortControllerSymbolId: registrationCancellation.abortControllerSymbolId,
          hasUnknownCancellation: registrationCancellation.hasUnknownCancellation,
        });
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

const analyzeCleanupBody = (
  cleanupBody: EsTreeNode,
  context: RuleContext,
): CleanupAnalysis | null => {
  const removals: ListenerCandidate[] = [];
  const abortedControllerSymbolIds = new Set<number>();
  let hasAmbiguousReachability = false;
  let hasUnknownAbortCall = false;
  let hasUnknownRemovalCall = false;
  const finalCleanupStatement = isNodeOfType(cleanupBody, "BlockStatement")
    ? cleanupBody.body[cleanupBody.body.length - 1]
    : null;
  walkAst(cleanupBody, (child: EsTreeNode) => {
    if (child !== cleanupBody && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ClassDeclaration") || isNodeOfType(child, "ClassExpression")) {
      return false;
    }
    if (isNodeOfType(child, "ReturnStatement") && child === finalCleanupStatement) {
      return;
    }
    if (isNodeOfType(child, "ReturnStatement") || isNodeOfType(child, "ThrowStatement")) {
      hasAmbiguousReachability = true;
      return false;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    if (isPathAmbiguousCall(child, cleanupBody)) return;
    const removalTarget = readDirectMemberReceiver(child.callee, "removeEventListener");
    if (removalTarget) {
      const removal = readListenerCandidate(child, "removeEventListener", context);
      if (removal) {
        removals.push(removal);
      } else {
        hasUnknownRemovalCall = true;
      }
    }
    const controllerNode = readDirectMemberReceiver(child.callee, "abort");
    if (!controllerNode) return;
    const controllerSymbolId = resolveLocalAbortControllerSymbolId(controllerNode, context);
    if (controllerSymbolId === null) {
      hasUnknownAbortCall = true;
    } else {
      abortedControllerSymbolIds.add(controllerSymbolId);
    }
  });
  if (hasAmbiguousReachability) return null;
  return {
    removals,
    abortedControllerSymbolIds,
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
  let hasUnknownAbortCall = false;
  let hasUnknownRemovalCall = false;
  for (const cleanupBody of effectInputs.cleanupBodies) {
    const cleanupAnalysis = analyzeCleanupBody(cleanupBody, context);
    if (!cleanupAnalysis) return null;
    removals.push(...cleanupAnalysis.removals);
    hasUnknownAbortCall ||= cleanupAnalysis.hasUnknownAbortCall;
    hasUnknownRemovalCall ||= cleanupAnalysis.hasUnknownRemovalCall;
    for (const controllerSymbolId of cleanupAnalysis.abortedControllerSymbolIds) {
      abortedControllerSymbolIds.add(controllerSymbolId);
    }
  }
  return {
    registrations: effectInputs.registrations,
    removals,
    abortedControllerSymbolIds,
    hasUnknownAbortCall,
    hasUnknownRemovalCall,
  };
};

const buildMismatchMessage = (
  registration: ListenerRegistration,
  removalCapture: boolean,
  callbackComparison: "different" | "same",
): string => {
  const hasCallbackMismatch = callbackComparison === "different";
  const hasCaptureMismatch = registration.capture !== removalCapture;
  if (hasCallbackMismatch && hasCaptureMismatch) {
    return `The cleanup removes \`${registration.eventName}\` with a different callback binding and capture ${String(removalCapture)}, but it was registered with capture ${String(registration.capture)}. Pass the same callback binding and capture flag to both EventTarget calls.`;
  }
  if (hasCallbackMismatch) {
    return `The cleanup removes \`${registration.eventName}\` with a different callback binding than the one registered, so \`removeEventListener\` cannot detach that listener. Pass the same callback binding to both calls.`;
  }
  return `The cleanup removes \`${registration.eventName}\` with capture ${String(removalCapture)}, but it was registered with capture ${String(registration.capture)}. \`removeEventListener\` must use the same capture flag as \`addEventListener\`.`;
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
        if (
          registration.abortControllerSymbolId !== null &&
          (listenerAnalysis.hasUnknownAbortCall ||
            listenerAnalysis.abortedControllerSymbolIds.has(registration.abortControllerSymbolId))
        ) {
          continue;
        }
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
          const callbackComparison = compareCallbackIdentities(
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
          message: buildMismatchMessage(
            registration,
            firstProvableMismatch.removalCapture,
            firstProvableMismatch.callbackComparison,
          ),
        });
      }
    },
  }),
});
