import type { ScopeDescriptor, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExpressionKey } from "./resolve-expression-key.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface MethodMutationIndex {
  memberMutationCandidatesByReceiverIdentity: Map<string, EsTreeNode[]>;
  memberMutationCandidatesByReceiverIdentityAndMethod: Map<string, Map<string, EsTreeNode[]>>;
  receiverAssignmentCandidatesByIdentity: Map<string, EsTreeNode[]>;
}

interface SymbolEscape {
  argumentIndex: number;
  callExpression: EsTreeNode;
}

const addCandidate = (map: Map<string, EsTreeNode[]>, key: string, node: EsTreeNode): void => {
  const candidates = map.get(key) ?? [];
  candidates.push(node);
  map.set(key, candidates);
};

const addMethodCandidate = (
  index: MethodMutationIndex,
  receiverIdentity: string,
  methodName: string,
  node: EsTreeNode,
): void => {
  const candidatesByMethod =
    index.memberMutationCandidatesByReceiverIdentityAndMethod.get(receiverIdentity) ?? new Map();
  addCandidate(candidatesByMethod, methodName, node);
  index.memberMutationCandidatesByReceiverIdentityAndMethod.set(
    receiverIdentity,
    candidatesByMethod,
  );
};

const getMethodCandidates = (
  index: MethodMutationIndex,
  receiverIdentity: string,
  methodName: string,
): EsTreeNode[] =>
  index.memberMutationCandidatesByReceiverIdentityAndMethod
    .get(receiverIdentity)
    ?.get(methodName) ?? [];

const recordMemberMutationTarget = (
  index: MethodMutationIndex,
  mutationTarget: EsTreeNode,
  node: EsTreeNode,
  context: RuleContext,
): void => {
  if (!isNodeOfType(mutationTarget, "MemberExpression")) return;
  const methodName = getStaticPropertyName(mutationTarget);
  const receiverIdentity = resolveExpressionKey(mutationTarget.object, context);
  if (methodName && receiverIdentity) {
    addCandidate(index.memberMutationCandidatesByReceiverIdentity, receiverIdentity, node);
    addMethodCandidate(index, receiverIdentity, methodName, node);
  }
};

const recordMethodMutationNode = (
  index: MethodMutationIndex,
  node: EsTreeNode,
  context: RuleContext,
): void => {
  if (isNodeOfType(node, "AssignmentExpression")) {
    const assignmentTarget = stripParenExpression(node.left);
    const assignmentIdentity = resolveExpressionKey(assignmentTarget, context);
    if (assignmentIdentity) {
      addCandidate(index.receiverAssignmentCandidatesByIdentity, assignmentIdentity, node);
    }
    recordMemberMutationTarget(index, assignmentTarget, node, context);
  } else if (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") {
    recordMemberMutationTarget(index, stripParenExpression(node.argument), node, context);
  }
  if (!isNodeOfType(node, "CallExpression")) return;
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticPropertyName(callee) !== "defineProperty"
  ) {
    return;
  }
  const methodArgument = node.arguments[1];
  const targetArgument = node.arguments[0];
  if (
    isNodeOfType(methodArgument, "Literal") &&
    typeof methodArgument.value === "string" &&
    targetArgument &&
    !isNodeOfType(targetArgument, "SpreadElement")
  ) {
    const targetIdentity = resolveExpressionKey(targetArgument, context);
    if (targetIdentity) {
      addCandidate(index.memberMutationCandidatesByReceiverIdentity, targetIdentity, node);
      addMethodCandidate(index, targetIdentity, methodArgument.value, node);
    }
  }
};

const isGlobalDefinePropertyCallForMethod = (
  callExpression: EsTreeNode,
  methodName: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const calleeObject = stripParenExpression(callee.object);
  return (
    getStaticPropertyName(callee) === "defineProperty" &&
    isNodeOfType(calleeObject, "Identifier") &&
    (calleeObject.name === "Object" || calleeObject.name === "Reflect") &&
    context.scopes.isGlobalReference(calleeObject) &&
    isNodeOfType(callExpression.arguments[1], "Literal") &&
    callExpression.arguments[1].value === methodName
  );
};

const isScopeAncestorOf = (ancestor: ScopeDescriptor, descendant: ScopeDescriptor): boolean => {
  let scope: ScopeDescriptor | null = descendant;
  while (scope) {
    if (scope === ancestor) return true;
    scope = scope.parent;
  }
  return false;
};

const readsMutatedMemberReceiver = (node: EsTreeNode, methodName: string): EsTreeNode | null => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "MemberExpression")) return null;
  return getStaticPropertyName(expression) === methodName ? expression.object : null;
};

const isAstAncestorOf = (ancestor: EsTreeNode, descendant: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = descendant;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
};

const getDirectFunctionInvocations = (
  functionNode: EsTreeNode,
  context: RuleContext,
): EsTreeNode[] | null => {
  const bindingIdentifier = isNodeOfType(functionNode, "FunctionDeclaration")
    ? functionNode.id
    : isNodeOfType(functionNode.parent, "VariableDeclarator") &&
        functionNode.parent.init === functionNode &&
        isNodeOfType(functionNode.parent.id, "Identifier")
      ? functionNode.parent.id
      : null;
  const functionSymbol = bindingIdentifier
    ? context.scopes.scopeFor(functionNode).symbolsByName.get(bindingIdentifier.name)
    : undefined;
  if (!functionSymbol || functionSymbol.references.length === 0) return null;
  const invocations: EsTreeNode[] = [];
  for (const reference of functionSymbol.references) {
    const referenceParent = reference.identifier.parent;
    if (
      !isNodeOfType(referenceParent, "CallExpression") ||
      stripParenExpression(referenceParent.callee) !== reference.identifier
    ) {
      return null;
    }
    if (context.cfg.enclosingFunction(referenceParent) === functionNode) continue;
    invocations.push(referenceParent);
  }
  return invocations.length > 0 ? invocations : null;
};

const isConstructorMutationForMethodCall = (
  mutationOwner: EsTreeNode,
  callOwner: EsTreeNode,
  mutationNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const mutationDefinition = mutationOwner.parent;
  const callDefinition = callOwner.parent;
  if (
    !isNodeOfType(mutationDefinition, "MethodDefinition") ||
    !isNodeOfType(callDefinition, "MethodDefinition") ||
    mutationDefinition.parent !== callDefinition.parent ||
    !isNodeOfType(mutationDefinition.key, "Identifier") ||
    mutationDefinition.key.name !== "constructor"
  ) {
    return false;
  }
  return context.cfg.isUnconditionalFromEntry(mutationNode);
};

const mutationDominatesCall = (
  mutationNode: EsTreeNode,
  callNode: EsTreeNode,
  context: RuleContext,
  visitedCallNodesByMutation: Map<EsTreeNode, Set<EsTreeNode>> = new Map(),
): boolean => {
  const visitedCallNodes = visitedCallNodesByMutation.get(mutationNode) ?? new Set();
  if (visitedCallNodes.has(callNode)) return false;
  const nextVisitedCallNodesByMutation = new Map(visitedCallNodesByMutation);
  nextVisitedCallNodesByMutation.set(mutationNode, new Set([...visitedCallNodes, callNode]));
  const mutationOwner = context.cfg.enclosingFunction(mutationNode);
  const callOwner = context.cfg.enclosingFunction(callNode);
  if (!mutationOwner || !callOwner) return false;
  if (mutationOwner !== callOwner) {
    if (isConstructorMutationForMethodCall(mutationOwner, callOwner, mutationNode, context)) {
      return true;
    }
    if (isAstAncestorOf(mutationOwner, callOwner)) {
      const callOwnerInvocations = getDirectFunctionInvocations(callOwner, context);
      if (
        !callOwnerInvocations &&
        isNodeOfType(mutationOwner, "Program") &&
        context.cfg.isUnconditionalFromEntry(mutationNode)
      ) {
        return true;
      }
      return Boolean(
        callOwnerInvocations &&
        callOwnerInvocations.every((invocation) =>
          mutationDominatesCall(mutationNode, invocation, context, nextVisitedCallNodesByMutation),
        ),
      );
    }
    if (isAstAncestorOf(callOwner, mutationOwner)) {
      const mutationOwnerInvocations = getDirectFunctionInvocations(mutationOwner, context);
      return Boolean(
        context.cfg.isUnconditionalFromEntry(mutationNode) &&
        mutationOwnerInvocations?.some((invocation) =>
          mutationDominatesCall(invocation, callNode, context, nextVisitedCallNodesByMutation),
        ),
      );
    }
    const mutationOwnerInvocations = getDirectFunctionInvocations(mutationOwner, context);
    const callOwnerInvocations = getDirectFunctionInvocations(callOwner, context);
    if (
      context.cfg.isUnconditionalFromEntry(mutationNode) &&
      mutationOwnerInvocations &&
      callOwnerInvocations
    ) {
      return callOwnerInvocations.every(
        (callInvocation) =>
          mutationDominatesCall(
            mutationNode,
            callInvocation,
            context,
            nextVisitedCallNodesByMutation,
          ) ||
          mutationOwnerInvocations.some((mutationInvocation) =>
            mutationDominatesCall(
              mutationInvocation,
              callInvocation,
              context,
              nextVisitedCallNodesByMutation,
            ),
          ),
      );
    }
    return false;
  }
  const cfg = context.cfg.cfgFor(callOwner);
  const mutationBlock = cfg?.blockOf(mutationNode);
  const callBlock = cfg?.blockOf(callNode);
  if (!cfg || !mutationBlock || !callBlock) return mutationNode.range[0] < callNode.range[0];
  if (mutationBlock === callBlock) return mutationNode.range[0] < callNode.range[0];
  const visitedBlocks = new Set<typeof cfg.entry>();
  const pendingBlocks = mutationBlock === cfg.entry ? [] : [cfg.entry];
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.shift();
    if (!block || visitedBlocks.has(block)) continue;
    if (block === callBlock) return false;
    visitedBlocks.add(block);
    for (const edge of block.successors) {
      if (edge.to !== mutationBlock) pendingBlocks.push(edge.to);
    }
  }
  return true;
};

const mutationsCollectivelyDominateCall = (
  mutationNodes: readonly EsTreeNode[],
  callNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const callOwner = context.cfg.enclosingFunction(callNode);
  if (!callOwner || mutationNodes.length < 2) return false;
  if (
    mutationNodes.some((mutationNode) => context.cfg.enclosingFunction(mutationNode) !== callOwner)
  ) {
    return false;
  }
  const cfg = context.cfg.cfgFor(callOwner);
  const callBlock = cfg?.blockOf(callNode);
  if (!cfg || !callBlock) return false;
  const mutationBlocks = new Set(
    mutationNodes
      .map((mutationNode) => cfg.blockOf(mutationNode))
      .filter((block) => block !== null),
  );
  if (
    mutationNodes.some(
      (mutationNode) =>
        cfg.blockOf(mutationNode) === callBlock && mutationNode.range[0] < callNode.range[0],
    )
  ) {
    return true;
  }
  mutationBlocks.delete(callBlock);
  const visitedBlocks = new Set<typeof cfg.entry>();
  const pendingBlocks = [cfg.entry];
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.shift();
    if (!block || visitedBlocks.has(block) || mutationBlocks.has(block)) continue;
    if (block === callBlock) return false;
    visitedBlocks.add(block);
    for (const edge of block.successors) pendingBlocks.push(edge.to);
  }
  return true;
};

const getLocalCalledFunction = (
  callExpression: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(callee);
  const candidate = symbol?.initializer ?? symbol?.declarationNode;
  return candidate && isFunctionLike(stripParenExpression(candidate))
    ? stripParenExpression(candidate)
    : null;
};

const hasDominatingEscapeMutation = (
  symbol: SymbolDescriptor,
  callNode: EsTreeNode,
  context: RuleContext,
  mutationIndex: MethodMutationIndex,
): boolean =>
  getSymbolEscapeCalls(symbol, context).some(
    (escape) =>
      escape.callExpression !== callNode &&
      mutationDominatesCall(escape.callExpression, callNode, context) &&
      callMayMutateArgument(
        escape.callExpression,
        escape.argumentIndex,
        context,
        mutationIndex,
        new Map(),
      ),
  );

const factoryReturnsMutatedReceiver = (
  receiver: EsTreeNode,
  methodName: string,
  context: RuleContext,
  mutationIndex: MethodMutationIndex,
): boolean => {
  const factory = getLocalCalledFunction(stripParenExpression(receiver), context);
  if (!factory || !isFunctionLike(factory)) return false;
  const returnStatements: EsTreeNode[] = [];
  walkAst(factory.body, (node) => {
    if (node !== factory.body && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement") && node.argument) returnStatements.push(node);
  });
  return (
    returnStatements.length > 0 &&
    returnStatements.every((returnStatement) => {
      if (!isNodeOfType(returnStatement, "ReturnStatement") || !returnStatement.argument) {
        return false;
      }
      const returnedIdentity = resolveExpressionKey(returnStatement.argument, context);
      if (!returnedIdentity) return false;
      const returnedExpression = stripParenExpression(returnStatement.argument);
      const returnedSymbol = isNodeOfType(returnedExpression, "Identifier")
        ? context.scopes.symbolFor(returnedExpression)
        : null;
      if (
        returnedSymbol &&
        hasDominatingEscapeMutation(returnedSymbol, returnStatement, context, mutationIndex)
      ) {
        return true;
      }
      return Boolean(
        mutationIndex.memberMutationCandidatesByReceiverIdentity
          .get(returnedIdentity)
          ?.some((mutationNode) => {
            let doesMutateMethod = Boolean(
              readsMutatedMemberReceiver(
                isNodeOfType(mutationNode, "AssignmentExpression")
                  ? mutationNode.left
                  : isNodeOfType(mutationNode, "UnaryExpression")
                    ? mutationNode.argument
                    : mutationNode,
                methodName,
              ),
            );
            if (isNodeOfType(mutationNode, "CallExpression")) {
              doesMutateMethod = isGlobalDefinePropertyCallForMethod(
                mutationNode,
                methodName,
                context,
              );
            }
            return (
              doesMutateMethod && mutationDominatesCall(mutationNode, returnStatement, context)
            );
          }),
      );
    })
  );
};

const escapeCallsBySymbol = new WeakMap<SymbolDescriptor, SymbolEscape[]>();

const getSymbolEscapeCalls = (
  symbol: SymbolDescriptor,
  context: RuleContext,
  visitedSymbols: Set<SymbolDescriptor> = new Set(),
): SymbolEscape[] => {
  const cachedEscapeCalls = escapeCallsBySymbol.get(symbol);
  if (cachedEscapeCalls) return cachedEscapeCalls;
  if (visitedSymbols.has(symbol)) return [];
  const nextVisitedSymbols = new Set(visitedSymbols);
  nextVisitedSymbols.add(symbol);
  const escapeCalls = new Map<EsTreeNode, Set<number>>();
  const addEscapeCall = (callExpression: EsTreeNode, argumentIndex: number): void => {
    const argumentIndexes = escapeCalls.get(callExpression) ?? new Set();
    argumentIndexes.add(argumentIndex);
    escapeCalls.set(callExpression, argumentIndexes);
  };
  const mergeAliasEscapeCalls = (aliasSymbol: SymbolDescriptor | null | undefined): void => {
    if (!aliasSymbol) return;
    for (const escape of getSymbolEscapeCalls(aliasSymbol, context, nextVisitedSymbols)) {
      addEscapeCall(escape.callExpression, escape.argumentIndex);
    }
  };
  for (const reference of symbol.references) {
    let argumentExpression = reference.identifier;
    let didResolveExpression = true;
    while (argumentExpression.parent && didResolveExpression) {
      const parent = argumentExpression.parent;
      didResolveExpression = false;
      if (stripParenExpression(parent) === argumentExpression) {
        argumentExpression = parent;
        didResolveExpression = true;
      } else if (
        isNodeOfType(parent, "Property") &&
        parent.value === argumentExpression &&
        isNodeOfType(parent.parent, "ObjectExpression")
      ) {
        argumentExpression = parent.parent;
        didResolveExpression = true;
      } else if (
        isNodeOfType(parent, "ArrayExpression") &&
        parent.elements.some((element) => element === argumentExpression)
      ) {
        argumentExpression = parent;
        didResolveExpression = true;
      } else if (
        isNodeOfType(parent, "ObjectExpression") &&
        parent.properties.some((property) => property === argumentExpression)
      ) {
        argumentExpression = parent;
        didResolveExpression = true;
      } else if (isNodeOfType(parent, "SpreadElement") && parent.argument === argumentExpression) {
        argumentExpression = parent;
        didResolveExpression = true;
      }
    }
    const expressionParent = argumentExpression.parent;
    if (
      isNodeOfType(expressionParent, "VariableDeclarator") &&
      expressionParent.init === argumentExpression &&
      isNodeOfType(expressionParent.id, "Identifier")
    ) {
      mergeAliasEscapeCalls(
        context.scopes.scopeFor(expressionParent).symbolsByName.get(expressionParent.id.name),
      );
      continue;
    }
    if (
      isNodeOfType(expressionParent, "AssignmentExpression") &&
      expressionParent.right === argumentExpression
    ) {
      const assignmentTarget = stripParenExpression(expressionParent.left);
      const aliasIdentifier = isNodeOfType(assignmentTarget, "Identifier")
        ? assignmentTarget
        : isNodeOfType(assignmentTarget, "MemberExpression") &&
            isNodeOfType(stripParenExpression(assignmentTarget.object), "Identifier")
          ? stripParenExpression(assignmentTarget.object)
          : null;
      mergeAliasEscapeCalls(aliasIdentifier ? context.scopes.symbolFor(aliasIdentifier) : null);
      continue;
    }
    if (isNodeOfType(expressionParent, "CallExpression")) {
      const argumentIndex = expressionParent.arguments.findIndex(
        (argument) => argument === argumentExpression,
      );
      if (argumentIndex >= 0) addEscapeCall(expressionParent, argumentIndex);
    }
  }
  const result = [...escapeCalls].flatMap(([callExpression, argumentIndexes]) =>
    [...argumentIndexes].map((argumentIndex) => ({ argumentIndex, callExpression })),
  );
  escapeCallsBySymbol.set(symbol, result);
  return result;
};

const functionReturnsParameter = (
  functionNode: EsTreeNode,
  parameterIdentity: string,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  if (
    isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode.body, "BlockStatement")
  ) {
    return resolveExpressionKey(functionNode.body, context) === parameterIdentity;
  }
  const returnStatements: EsTreeNode[] = [];
  walkAst(functionNode.body, (node) => {
    if (node !== functionNode.body && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement")) returnStatements.push(node);
  });
  return (
    returnStatements.length > 0 &&
    returnStatements.every(
      (returnStatement) =>
        isNodeOfType(returnStatement, "ReturnStatement") &&
        returnStatement.argument &&
        resolveExpressionKey(returnStatement.argument, context) === parameterIdentity,
    )
  );
};

const getCallResultSymbol = (
  callExpression: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  let expression = callExpression;
  while (expression.parent && stripParenExpression(expression.parent) === expression) {
    expression = expression.parent;
  }
  const declarator = expression.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== expression ||
    !isNodeOfType(declarator.id, "Identifier")
  ) {
    return null;
  }
  let scope: ScopeDescriptor | null = context.scopes.scopeFor(declarator);
  while (scope) {
    const symbol = scope.symbolsByName.get(declarator.id.name);
    if (symbol) return symbol;
    scope = scope.parent;
  }
  return null;
};

const callMayMutateArgument = (
  callExpression: EsTreeNode,
  argumentIndex: number,
  context: RuleContext,
  mutationIndex: MethodMutationIndex,
  visitedParameterIndexesByFunction: Map<EsTreeNode, Set<number>>,
): boolean => {
  const calledFunction = getLocalCalledFunction(callExpression, context);
  if (!calledFunction || !isFunctionLike(calledFunction)) return true;
  if (calledFunction.generator) return false;
  const visitedParameterIndexes =
    visitedParameterIndexesByFunction.get(calledFunction) ?? new Set<number>();
  if (visitedParameterIndexes.has(argumentIndex)) return false;
  visitedParameterIndexes.add(argumentIndex);
  visitedParameterIndexesByFunction.set(calledFunction, visitedParameterIndexes);
  const parameter = calledFunction.params[argumentIndex];
  if (!isNodeOfType(parameter, "Identifier")) return true;
  const parameterSymbol = context.scopes
    .ownScopeFor(calledFunction)
    ?.symbolsByName.get(parameter.name);
  if (!parameterSymbol) return true;
  const parameterIdentity = `symbol:${parameterSymbol.id}`;
  if (
    mutationIndex.memberMutationCandidatesByReceiverIdentity
      .get(parameterIdentity)
      ?.some((mutation) => context.cfg.enclosingFunction(mutation) === calledFunction)
  ) {
    return true;
  }
  const doesParameterEscape = getSymbolEscapeCalls(parameterSymbol, context).some((escape) => {
    if (context.cfg.enclosingFunction(escape.callExpression) !== calledFunction) return false;
    return callMayMutateArgument(
      escape.callExpression,
      escape.argumentIndex,
      context,
      mutationIndex,
      visitedParameterIndexesByFunction,
    );
  });
  if (doesParameterEscape) return true;
  if (!functionReturnsParameter(calledFunction, parameterIdentity, context)) return false;
  const resultSymbol = getCallResultSymbol(callExpression, context);
  if (!resultSymbol) return false;
  return getSymbolEscapeCalls(resultSymbol, context).some((escape) =>
    callMayMutateArgument(
      escape.callExpression,
      escape.argumentIndex,
      context,
      mutationIndex,
      visitedParameterIndexesByFunction,
    ),
  );
};

const hasProvenMethodMutation = (
  mutationIndex: MethodMutationIndex,
  receiver: EsTreeNode,
  methodName: string,
  callNode: EsTreeNode,
  context: RuleContext,
  prototypeOwnerNames: readonly string[] = [],
  isProvenReceiverReplacement?: (expression: EsTreeNode) => boolean,
): boolean => {
  if (factoryReturnsMutatedReceiver(receiver, methodName, context, mutationIndex)) return true;
  const receiverIdentity = resolveExpressionKey(receiver, context);
  const receiverExpression = stripParenExpression(receiver);
  const receiverSymbol = isNodeOfType(receiverExpression, "Identifier")
    ? context.scopes.symbolFor(receiverExpression)
    : null;
  if (
    receiverIdentity &&
    receiverSymbol &&
    hasDominatingEscapeMutation(receiverSymbol, callNode, context, mutationIndex)
  ) {
    return true;
  }
  const callScope = context.scopes.scopeFor(callNode);
  let didFindMutation = false;
  const mutationCandidates = new Set([
    ...(receiverIdentity ? getMethodCandidates(mutationIndex, receiverIdentity, methodName) : []),
    ...prototypeOwnerNames.flatMap((prototypeOwnerName) =>
      getMethodCandidates(mutationIndex, `global:${prototypeOwnerName}.prototype`, methodName),
    ),
    ...(receiverIdentity
      ? (mutationIndex.receiverAssignmentCandidatesByIdentity.get(receiverIdentity) ?? [])
      : []),
  ]);
  const matchingMutationCandidates: EsTreeNode[] = [];
  for (const child of mutationCandidates) {
    if (didFindMutation) break;
    const childScope = context.scopes.scopeFor(child);
    if (
      !isScopeAncestorOf(childScope, callScope) &&
      !mutationDominatesCall(child, callNode, context)
    ) {
      continue;
    }
    let mutatedReceiver: EsTreeNode | null = null;
    if (isNodeOfType(child, "AssignmentExpression")) {
      if (
        receiverIdentity !== null &&
        resolveExpressionKey(child.left, context) === receiverIdentity
      ) {
        if (isProvenReceiverReplacement?.(child.right)) continue;
        matchingMutationCandidates.push(child);
        if (mutationDominatesCall(child, callNode, context)) {
          didFindMutation = true;
          break;
        }
        continue;
      }
      mutatedReceiver = readsMutatedMemberReceiver(child.left, methodName);
    } else if (isNodeOfType(child, "UnaryExpression") && child.operator === "delete") {
      mutatedReceiver = readsMutatedMemberReceiver(child.argument, methodName);
    } else if (
      isNodeOfType(child, "CallExpression") &&
      isGlobalDefinePropertyCallForMethod(child, methodName, context)
    ) {
      const target = child.arguments[0];
      mutatedReceiver = target && !isNodeOfType(target, "SpreadElement") ? target : null;
    }
    if (!mutatedReceiver) continue;
    const mutatedReceiverIdentity = resolveExpressionKey(mutatedReceiver, context);
    const doesMutationMatchReceiver =
      (receiverIdentity !== null && mutatedReceiverIdentity === receiverIdentity) ||
      prototypeOwnerNames.some(
        (prototypeOwnerName) =>
          mutatedReceiverIdentity === `global:${prototypeOwnerName}.prototype`,
      );
    if (!doesMutationMatchReceiver) continue;
    matchingMutationCandidates.push(child);
    if (mutationDominatesCall(child, callNode, context)) {
      didFindMutation = true;
    }
  }
  return (
    didFindMutation ||
    mutationsCollectivelyDominateCall(matchingMutationCandidates, callNode, context)
  );
};

export interface MethodMutationAnalysis {
  readonly record: (node: EsTreeNode) => void;
  readonly hasProvenMutation: (
    receiver: EsTreeNode,
    methodName: string,
    callNode: EsTreeNode,
    prototypeOwnerNames?: readonly string[],
    isProvenReceiverReplacement?: (expression: EsTreeNode) => boolean,
  ) => boolean;
}

export const createMethodMutationAnalysis = (context: RuleContext): MethodMutationAnalysis => {
  const mutationIndex: MethodMutationIndex = {
    memberMutationCandidatesByReceiverIdentity: new Map(),
    memberMutationCandidatesByReceiverIdentityAndMethod: new Map(),
    receiverAssignmentCandidatesByIdentity: new Map(),
  };
  return {
    record: (node) => recordMethodMutationNode(mutationIndex, node, context),
    hasProvenMutation: (
      receiver,
      methodName,
      callNode,
      prototypeOwnerNames,
      isProvenReceiverReplacement,
    ) =>
      hasProvenMethodMutation(
        mutationIndex,
        receiver,
        methodName,
        callNode,
        context,
        prototypeOwnerNames,
        isProvenReceiverReplacement,
      ),
  };
};
