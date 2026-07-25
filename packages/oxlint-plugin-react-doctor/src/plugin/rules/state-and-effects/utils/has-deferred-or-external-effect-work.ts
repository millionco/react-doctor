import {
  EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS,
  TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES,
  TIMER_CLEANUP_CALLEE_NAMES,
} from "../../../constants/dom.js";
import { FETCH_CALLEE_NAMES, FETCH_MEMBER_OBJECTS } from "../../../constants/library.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getFinalSequenceExpressionValue } from "../../../utils/get-final-sequence-expression-value.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../../utils/is-react-hook-call.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getRef, getUpstreamRefs, resolveToFunction } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { getEffectDepsRefs, getEffectFn, isProp, isState } from "./effect/react.js";
import { isSubscribeOrObserveCallExpression } from "./is-subscribe-like-call-expression.js";

interface FunctionInvocationEdge {
  parentFunction: EsTreeNode;
  callExpression: EsTreeNode;
  invokedFunction: EsTreeNode;
}

interface FunctionTraversalFrame {
  functionNode: EsTreeNode;
  invocationPath: ReadonlyArray<FunctionInvocationEdge>;
}

const DEFERRED_MEMBER_NAMES: ReadonlySet<string> = new Set(["catch", "finally", "then"]);
const GLOBAL_NAMESPACE_NAMES: ReadonlySet<string> = new Set(["globalThis", "self", "window"]);
const TIMEOUT_HOOK_NAME = "useTimeouts";
const SYNCHRONOUS_ITERATOR_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
]);

const resolveInvokedFunction = (
  analysis: ProgramAnalysis,
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const exactLocalFunction = resolveExactLocalFunction(callee, scopes);
  if (exactLocalFunction) return exactLocalFunction;
  if (!isNodeOfType(callee, "Identifier")) return null;
  const reference = getRef(analysis, callee);
  const resolvedFunction = reference ? resolveToFunction(reference) : null;
  if (!resolvedFunction) return null;
  const definitionNode = reference?.resolved?.defs[0]?.node as unknown as EsTreeNode | undefined;
  if (!definitionNode || !isNodeOfType(definitionNode, "VariableDeclarator")) return null;
  return isNodeOfType(definitionNode.init, "CallExpression") &&
    isReactHookCall(definitionNode.init, "useCallback", scopes)
    ? resolvedFunction
    : null;
};

const isFetchCall = (callExpression: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "Identifier")) return FETCH_CALLEE_NAMES.has(callee.name);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const root = stripParenExpression(callee.object as EsTreeNode);
  return isNodeOfType(root, "Identifier") && FETCH_MEMBER_OBJECTS.has(root.name);
};

const getImportedTimeoutHookOperationName = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const operationSymbol = scopes.symbolFor(identifier);
  const operationName = operationSymbol
    ? getDestructuredBindingPropertyName(operationSymbol.bindingIdentifier)
    : null;
  if (
    operationSymbol?.kind !== "const" ||
    !operationName ||
    (operationName !== "setTimeout" && operationName !== "clearTimeout") ||
    !operationSymbol.initializer ||
    !isNodeOfType(operationSymbol.initializer, "CallExpression")
  ) {
    return null;
  }
  const hookCallee = stripParenExpression(operationSymbol.initializer.callee);
  if (!isNodeOfType(hookCallee, "Identifier")) return null;
  const hookSymbol = scopes.symbolFor(hookCallee);
  if (
    hookSymbol?.kind !== "import" ||
    getImportedName(hookSymbol.declarationNode) !== TIMEOUT_HOOK_NAME
  ) {
    return null;
  }
  const objectPattern = operationSymbol.bindingIdentifier.parent?.parent;
  if (!objectPattern || !isNodeOfType(objectPattern, "ObjectPattern")) return null;
  const pairedOperationName = operationName === "setTimeout" ? "clearTimeout" : "setTimeout";
  const hasPairedOperation = objectPattern.properties.some(
    (property) =>
      isNodeOfType(property as EsTreeNode, "Property") &&
      getStaticPropertyKeyName(property as EsTreeNode, { allowComputedString: true }) ===
        pairedOperationName,
  );
  return hasPairedOperation ? operationName : null;
};

const resolveTimerOperationName = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): string | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    if (
      scopes.isGlobalReference(candidate) &&
      (TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES.has(candidate.name) ||
        TIMER_CLEANUP_CALLEE_NAMES.has(candidate.name))
    ) {
      return candidate.name;
    }
    const importedTimeoutHookOperationName = getImportedTimeoutHookOperationName(candidate, scopes);
    if (importedTimeoutHookOperationName) return importedTimeoutHookOperationName;
    const symbol = scopes.symbolFor(candidate);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id)
    ) {
      return null;
    }
    const nextVisitedSymbolIds = new Set(visitedSymbolIds).add(symbol.id);
    return resolveTimerOperationName(symbol.initializer, scopes, nextVisitedSymbolIds);
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return null;
  const memberName = getStaticPropertyName(candidate);
  if (
    !memberName ||
    (!TIMER_AND_SCHEDULER_DIRECT_CALLEE_NAMES.has(memberName) &&
      !TIMER_CLEANUP_CALLEE_NAMES.has(memberName))
  ) {
    return null;
  }
  const receiver = stripParenExpression(candidate.object as EsTreeNode);
  return isNodeOfType(receiver, "Identifier") &&
    GLOBAL_NAMESPACE_NAMES.has(receiver.name) &&
    scopes.isGlobalReference(receiver)
    ? memberName
    : null;
};

const getControlRegion = (node: EsTreeNode, containingFunction: EsTreeNode): EsTreeNode | null => {
  let child = node;
  let cursor = node.parent;
  while (cursor && cursor !== containingFunction) {
    if (isNodeOfType(cursor, "IfStatement")) {
      if (isAstDescendant(child, cursor.consequent as EsTreeNode)) {
        return cursor.consequent as EsTreeNode;
      }
      if (cursor.alternate && isAstDescendant(child, cursor.alternate as EsTreeNode)) {
        return cursor.alternate as EsTreeNode;
      }
    }
    if (isNodeOfType(cursor, "ConditionalExpression")) {
      if (isAstDescendant(child, cursor.consequent as EsTreeNode)) {
        return cursor.consequent as EsTreeNode;
      }
      if (isAstDescendant(child, cursor.alternate as EsTreeNode)) {
        return cursor.alternate as EsTreeNode;
      }
    }
    if (
      isNodeOfType(cursor, "LogicalExpression") &&
      isAstDescendant(child, cursor.right as EsTreeNode)
    ) {
      return cursor.right as EsTreeNode;
    }
    child = cursor;
    cursor = cursor.parent;
  }
  return null;
};

const doesControlRegionReadState = (
  controlRegion: EsTreeNode,
  stateSymbolId: number | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (stateSymbolId === null) return false;
  const parent = controlRegion.parent;
  const condition =
    isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")
      ? parent.test
      : isNodeOfType(parent, "LogicalExpression")
        ? parent.left
        : null;
  if (!condition) return false;
  let doesReadState = false;
  walkAst(condition as EsTreeNode, (child) => {
    if (child !== condition && isFunctionLike(child)) return false;
    const parent = child.parent;
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === child) {
      const leftBoolean = readStaticBoolean(getFinalSequenceExpressionValue(parent.left));
      if (
        (parent.operator === "&&" && leftBoolean === false) ||
        (parent.operator === "||" && leftBoolean === true)
      ) {
        return false;
      }
    }
    if (isNodeOfType(parent, "ConditionalExpression") && parent.test !== child) {
      const testBoolean = readStaticBoolean(getFinalSequenceExpressionValue(parent.test));
      if (
        (parent.consequent === child && testBoolean === false) ||
        (parent.alternate === child && testBoolean === true)
      ) {
        return false;
      }
    }
    if (isNodeOfType(child, "Identifier") && scopes.symbolFor(child)?.id === stateSymbolId) {
      doesReadState = true;
      return false;
    }
  });
  return doesReadState;
};

const isWorkRelatedToWrite = (
  analysis: ProgramAnalysis,
  workNode: EsTreeNode,
  workFunction: EsTreeNode,
  invocationPath: ReadonlyArray<FunctionInvocationEdge>,
  propDependencyBindings: ReadonlySet<unknown>,
  writeNode: EsTreeNode,
  writeFunction: EsTreeNode,
  writeStateSymbolId: number | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(writeNode, "CallExpression") && isNodeOfType(writeNode.callee, "Identifier")) {
    const setterBinding = getRef(analysis, writeNode.callee)?.resolved;
    if (setterBinding) {
      let writesSameState = false;
      walkAst(workNode, (child) => {
        if (writesSameState) return false;
        if (
          child !== writeNode &&
          isNodeOfType(child, "CallExpression") &&
          isNodeOfType(child.callee, "Identifier") &&
          getRef(analysis, child.callee)?.resolved === setterBinding
        ) {
          writesSameState = true;
          return false;
        }
      });
      if (writesSameState) return true;
    }
  }
  if (propDependencyBindings.size > 0) {
    const workPropBindings = new Set<unknown>();
    const workValueNodes = [
      workNode,
      ...invocationPath.map((invocationEdge) => invocationEdge.callExpression),
    ];
    for (const workValueNode of workValueNodes) {
      walkAst(workValueNode, (child) => {
        if (!isNodeOfType(child, "Identifier")) return;
        const reference = getRef(analysis, child);
        if (!reference) return;
        for (const upstreamReference of getUpstreamRefs(analysis, reference)) {
          if (isProp(analysis, upstreamReference)) {
            workPropBindings.add(upstreamReference.resolved ?? upstreamReference.identifier);
          }
        }
      });
    }
    if ([...propDependencyBindings].every((propBinding) => workPropBindings.has(propBinding))) {
      return true;
    }
  }
  let workAnchor = workNode;
  if (workFunction !== writeFunction) {
    const invocationEdge = invocationPath.findLast(
      (candidateEdge) => candidateEdge.parentFunction === writeFunction,
    );
    if (!invocationEdge) return false;
    workAnchor = invocationEdge.callExpression;
  }
  const workRegion = getControlRegion(workAnchor, writeFunction);
  const writeRegion = getControlRegion(writeNode, writeFunction);
  if (
    workRegion !== null &&
    workRegion === writeRegion &&
    doesControlRegionReadState(workRegion, writeStateSymbolId, scopes)
  ) {
    return true;
  }
  const writeInvocationEdge = invocationPath.find(
    (candidateEdge) => candidateEdge.invokedFunction === writeFunction,
  );
  if (!writeInvocationEdge) return false;
  const writeInvocationRegion = getControlRegion(
    writeInvocationEdge.callExpression,
    writeInvocationEdge.parentFunction,
  );
  return Boolean(
    writeInvocationRegion &&
    doesControlRegionReadState(writeInvocationRegion, writeStateSymbolId, scopes),
  );
};

export const hasDeferredOrExternalEffectWork = (
  analysis: ProgramAnalysis,
  effectNode: EsTreeNode,
  scopes: ScopeAnalysis,
  writeNode: EsTreeNode,
): boolean => {
  const effectFunction = getEffectFn(analysis, effectNode);
  const writeFunction = findEnclosingFunction(writeNode);
  if (!effectFunction || !writeFunction) return false;
  const writeStateSymbolId =
    isNodeOfType(writeNode, "CallExpression") && isNodeOfType(writeNode.callee, "Identifier")
      ? (resolveReactUseStatePair(writeNode.callee, scopes)?.stateSymbol?.id ?? null)
      : null;
  const propDependencyBindings = new Set<unknown>();
  for (const dependencyReference of getEffectDepsRefs(analysis, effectNode) ?? []) {
    const upstreamReferences = isState(analysis, dependencyReference)
      ? []
      : getUpstreamRefs(analysis, dependencyReference);
    for (const upstreamReference of upstreamReferences) {
      if (isProp(analysis, upstreamReference)) {
        propDependencyBindings.add(upstreamReference.resolved ?? upstreamReference.identifier);
      }
    }
  }
  const visitedInvocations = new WeakMap<EsTreeNode, Set<EsTreeNode | null>>();
  const pendingFrames: FunctionTraversalFrame[] = [
    { functionNode: effectFunction, invocationPath: [] },
  ];
  while (pendingFrames.length > 0) {
    const frame = pendingFrames.pop();
    if (!frame) continue;
    const invocation = frame.invocationPath.at(-1)?.callExpression ?? null;
    const functionInvocations = visitedInvocations.get(frame.functionNode) ?? new Set();
    if (functionInvocations.has(invocation)) continue;
    functionInvocations.add(invocation);
    visitedInvocations.set(frame.functionNode, functionInvocations);
    let didFindRelatedWork = false;
    walkAst(frame.functionNode, (child) => {
      if (didFindRelatedWork) return false;
      if (child !== frame.functionNode && isFunctionLike(child)) return false;
      if (isNodeOfType(child, "AssignmentExpression")) {
        const assignmentTarget = child.left;
        const handlerName = isNodeOfType(assignmentTarget, "MemberExpression")
          ? getStaticPropertyName(assignmentTarget)
          : null;
        if (
          handlerName?.startsWith("on") &&
          isFunctionLike(child.right) &&
          isWorkRelatedToWrite(
            analysis,
            child,
            frame.functionNode,
            frame.invocationPath,
            propDependencyBindings,
            writeNode,
            writeFunction,
            writeStateSymbolId,
            scopes,
          )
        ) {
          didFindRelatedWork = true;
          return false;
        }
      }
      if (isNodeOfType(child, "NewExpression")) {
        const constructor = stripParenExpression(child.callee);
        if (
          isNodeOfType(constructor, "Identifier") &&
          EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(constructor.name) &&
          scopes.isGlobalReference(constructor) &&
          isWorkRelatedToWrite(
            analysis,
            child,
            frame.functionNode,
            frame.invocationPath,
            propDependencyBindings,
            writeNode,
            writeFunction,
            writeStateSymbolId,
            scopes,
          )
        ) {
          didFindRelatedWork = true;
          return false;
        }
      }
      if (!isNodeOfType(child, "CallExpression")) return;
      const callee = stripParenExpression(child.callee);
      const memberName = isNodeOfType(callee, "MemberExpression")
        ? getStaticPropertyName(callee)
        : null;
      const localFunction = resolveInvokedFunction(analysis, callee, scopes);
      const isExternalWork =
        isFetchCall(child) ||
        isSubscribeOrObserveCallExpression(child) ||
        resolveTimerOperationName(callee, scopes) !== null ||
        Boolean(memberName && DEFERRED_MEMBER_NAMES.has(memberName)) ||
        Boolean(localFunction && isFunctionLike(localFunction) && localFunction.async);
      if (
        isExternalWork &&
        isWorkRelatedToWrite(
          analysis,
          child,
          frame.functionNode,
          frame.invocationPath,
          propDependencyBindings,
          writeNode,
          writeFunction,
          writeStateSymbolId,
          scopes,
        )
      ) {
        didFindRelatedWork = true;
        return false;
      }
      if (localFunction) {
        pendingFrames.push({
          functionNode: localFunction,
          invocationPath: [
            ...frame.invocationPath,
            {
              parentFunction: frame.functionNode,
              callExpression: child,
              invokedFunction: localFunction,
            },
          ],
        });
      }
      if (memberName && SYNCHRONOUS_ITERATOR_MEMBER_NAMES.has(memberName)) {
        for (const argument of child.arguments ?? []) {
          const iteratorFunction = resolveInvokedFunction(analysis, argument as EsTreeNode, scopes);
          if (!iteratorFunction) continue;
          pendingFrames.push({
            functionNode: iteratorFunction,
            invocationPath: [
              ...frame.invocationPath,
              {
                parentFunction: frame.functionNode,
                callExpression: child,
                invokedFunction: iteratorFunction,
              },
            ],
          });
        }
      }
    });
    if (didFindRelatedWork) return true;
  }
  return false;
};
