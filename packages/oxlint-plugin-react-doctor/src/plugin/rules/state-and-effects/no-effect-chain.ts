import {
  EXTERNAL_SYNC_DOM_MEMBER_METHOD_NAMES,
  EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS,
  SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP,
} from "../../constants/dom.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import {
  EFFECT_HOOK_NAMES,
  EXTERNAL_SYNC_AMBIGUOUS_HTTP_METHOD_NAMES,
  EXTERNAL_SYNC_DIRECT_CALLEE_NAMES,
  EXTERNAL_SYNC_MEMBER_METHOD_NAMES,
  HOOKS_WITH_DEPS,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getReactUseCallbackCall } from "../../utils/get-react-use-callback-call.js";
import { getRootIdentifier } from "../../utils/get-root-identifier.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getRequireCallSource } from "../../utils/get-require-call-source.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isProvenGlobalNamespaceReference } from "../../utils/is-proven-global-namespace-reference.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInlineIntrinsicRefCallback } from "../../utils/is-inline-intrinsic-ref-callback.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenBrowserApiReceiver } from "../../utils/is-proven-browser-api-receiver.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { unwrapDiscardedExpression } from "../../utils/unwrap-discarded-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { isCleanupReturn } from "./utils/is-cleanup-return.js";

// HACK: §7 of "You Might Not Need an Effect" — chains of computations:
//
//   useEffect(() => { if (card.gold) setGoldCardCount(c => c + 1); }, [card]);
//   useEffect(() => { if (goldCardCount > 3) setRound(r => r + 1); }, [goldCardCount]);
//   useEffect(() => { if (round > 5) setIsGameOver(true); }, [round]);
//
// Each link adds one extra render to the tree below the component.
// More importantly, the chain is rigid: setting `card` to a value from
// the past re-fires every downstream effect.
//
// `noCascadingSetState` (already shipped) catches multi-setter calls
// inside ONE effect; it does NOT see across effects. This rule
// complements it by detecting the cross-effect dependence.
//
// Detector (per component body):
//   1. Collect every top-level useEffect call and, for each:
//        - dependencyStateSymbolIds: state symbols referenced by the dep array
//        - writtenStateNames: state names whose setter is called in the body,
//          an ordinary local helper, or a stable callback graph proven to contain
//          one state transition and no opaque work
//        - reader reachability and isExternalSync follow stable useCallback
//          bodies so guards, cleanup, and recognized external-system work remain visible
//        - isExternalSync: body returns cleanup OR contains a recognized
//          external-system call (subscribe / addEventListener / fetch /
//          setInterval / new MutationObserver / etc.) OR mutates a ref
//   2. For every ordered pair (A, B) of distinct effects:
//        edge iff (writes(A) ∩ deps(B)) ≠ ∅  AND  ¬isExternalSync(A)
//                                            AND  ¬isExternalSync(B)
//   3. Report on every effect B that is the target of any edge,
//      naming the chained state and the upstream effect's writer.
//
// The article calls out one legitimate "chain" — a multi-step network
// cascade where each effect re-fetches based on the previous step's
// result. Those effects all have `isExternalSync = true` because they
// contain `fetch`, so the rule won't fire.
const findTopLevelEffectCalls = (
  componentBody: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode[] => {
  const effectCalls: EsTreeNode[] = [];
  if (!isNodeOfType(componentBody, "BlockStatement")) return effectCalls;
  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "ExpressionStatement")) continue;
    const expression = unwrapDiscardedExpression(statement);
    if (!isNodeOfType(expression, "CallExpression")) continue;
    if (!isReactHookCall(expression, EFFECT_HOOK_NAMES, scopes)) continue;
    effectCalls.push(expression);
  }
  return effectCalls;
};

const collectDependencyStateSymbolIds = (
  effectNode: EsTreeNode,
  stateSymbolIds: ReadonlySet<number>,
  scopes: ScopeAnalysis,
): Set<number> => {
  const dependencyStateSymbolIds = new Set<number>();
  if (!isNodeOfType(effectNode, "CallExpression")) return dependencyStateSymbolIds;
  const depsNode = effectNode.arguments?.[1];
  if (!isNodeOfType(depsNode, "ArrayExpression")) return dependencyStateSymbolIds;
  for (const element of depsNode.elements ?? []) {
    if (!element || isNodeOfType(element, "SpreadElement")) continue;
    const rootIdentifier = getRootIdentifier(element);
    if (!isNodeOfType(rootIdentifier, "Identifier")) continue;
    const symbol = resolveConstIdentifierAlias(rootIdentifier, scopes, true);
    if (symbol && stateSymbolIds.has(symbol.id)) dependencyStateSymbolIds.add(symbol.id);
  }
  return dependencyStateSymbolIds;
};

const resolveSynchronouslyInvokedFunction = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const localFunction = resolveExactLocalFunction(expression, scopes);
  if (localFunction) return localFunction;

  const useCallbackCall = getReactUseCallbackCall(expression, scopes);
  if (!useCallbackCall) return null;
  const callback = useCallbackCall.arguments[0];
  if (!callback || isNodeOfType(callback, "SpreadElement")) return null;
  return resolveExactLocalFunction(callback, scopes);
};

const collectSynchronouslyInvokedFunctions = (
  effectCallback: EsTreeNode,
  scopes: ScopeAnalysis,
  includeStableCallbacks = true,
): ReadonlySet<EsTreeNode> => {
  const analysisFunctions = new Set<EsTreeNode>([effectCallback]);
  const pendingFunctions = [effectCallback];
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.pop();
    if (!currentFunction || !isFunctionLike(currentFunction)) continue;
    walkInsideStatementBlocks(currentFunction.body, (child) => {
      if (!isNodeOfType(child, "CallExpression")) return;
      const invokedFunction = includeStableCallbacks
        ? resolveSynchronouslyInvokedFunction(child.callee, scopes)
        : resolveExactLocalFunction(child.callee, scopes);
      if (!invokedFunction || analysisFunctions.has(invokedFunction)) return;
      if (isFunctionLike(invokedFunction) && (invokedFunction.async || invokedFunction.generator)) {
        return;
      }
      analysisFunctions.add(invokedFunction);
      pendingFunctions.push(invokedFunction);
    });
  }
  return analysisFunctions;
};

const visitSynchronousFunctionBodies = (
  analysisFunctions: ReadonlySet<EsTreeNode>,
  visitor: (child: EsTreeNode) => void,
): void => {
  for (const analysisFunction of analysisFunctions) {
    if (!isFunctionLike(analysisFunction)) continue;
    walkInsideStatementBlocks(analysisFunction.body, visitor);
  }
};

const getStateNameForSetterCall = (
  node: EsTreeNode,
  setterSymbolIdToStateName: ReadonlyMap<number, string>,
  scopes: ScopeAnalysis,
): string | null => {
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "Identifier")) {
    return null;
  }
  const setterSymbol = resolveConstIdentifierAlias(node.callee, scopes, true);
  return setterSymbol ? (setterSymbolIdToStateName.get(setterSymbol.id) ?? null) : null;
};

const collectStateWriteAnalysisFunctions = (
  effectCallback: EsTreeNode,
  scopes: ScopeAnalysis,
  setterSymbolIdToStateName: ReadonlyMap<number, string>,
): ReadonlySet<EsTreeNode> => {
  const ordinaryAnalysisFunctions = collectSynchronouslyInvokedFunctions(
    effectCallback,
    scopes,
    false,
  );
  const fullAnalysisFunctions = collectSynchronouslyInvokedFunctions(effectCallback, scopes);
  const stableAnalysisFunctions = [...fullAnalysisFunctions].filter(
    (analysisFunction) => !ordinaryAnalysisFunctions.has(analysisFunction),
  );
  if (stableAnalysisFunctions.length === 0) return ordinaryAnalysisFunctions;

  let hasUnprovenObservableWork = stableAnalysisFunctions.some((analysisFunction) => {
    if (!isFunctionLike(analysisFunction)) return false;
    let hasExecutableDefault = false;
    for (const parameter of analysisFunction.params) {
      walkInsideStatementBlocks(parameter, (child) => {
        if (
          isNodeOfType(child, "CallExpression") ||
          isNodeOfType(child, "AssignmentExpression") ||
          isNodeOfType(child, "UpdateExpression") ||
          isNodeOfType(child, "ImportExpression") ||
          isNodeOfType(child, "NewExpression") ||
          isNodeOfType(child, "TaggedTemplateExpression") ||
          isNodeOfType(child, "ThrowStatement") ||
          (isNodeOfType(child, "UnaryExpression") && child.operator === "delete")
        ) {
          hasExecutableDefault = true;
        }
      });
      if (hasExecutableDefault) return true;
    }
    return false;
  });
  const stableWrittenStateNames = new Set<string>();
  const allWrittenStateNames = new Set<string>();
  visitSynchronousFunctionBodies(fullAnalysisFunctions, (child) => {
    const writtenStateName = getStateNameForSetterCall(child, setterSymbolIdToStateName, scopes);
    if (writtenStateName) allWrittenStateNames.add(writtenStateName);
  });
  visitSynchronousFunctionBodies(new Set(stableAnalysisFunctions), (child) => {
    if (hasUnprovenObservableWork) return;
    if (isNodeOfType(child, "CallExpression")) {
      const writtenStateName = getStateNameForSetterCall(child, setterSymbolIdToStateName, scopes);
      if (writtenStateName) {
        stableWrittenStateNames.add(writtenStateName);
        return;
      }
      const invokedFunction = resolveSynchronouslyInvokedFunction(child.callee, scopes);
      if (invokedFunction && fullAnalysisFunctions.has(invokedFunction)) return;
      hasUnprovenObservableWork = true;
      return;
    }
    if (
      isNodeOfType(child, "AssignmentExpression") ||
      isNodeOfType(child, "UpdateExpression") ||
      isNodeOfType(child, "ImportExpression") ||
      isNodeOfType(child, "NewExpression") ||
      isNodeOfType(child, "TaggedTemplateExpression") ||
      isNodeOfType(child, "ThrowStatement") ||
      (isNodeOfType(child, "UnaryExpression") && child.operator === "delete")
    ) {
      hasUnprovenObservableWork = true;
    }
  });

  return !hasUnprovenObservableWork &&
    stableWrittenStateNames.size === 1 &&
    allWrittenStateNames.size === 1
    ? fullAnalysisFunctions
    : ordinaryAnalysisFunctions;
};

interface StaticEffectStateValue {
  value: boolean | number | string | null | undefined;
}

interface EffectStateWriteInfo {
  values: Set<boolean | number | string | null | undefined>;
  hasUnknownValue: boolean;
}

const readStaticEffectValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  stateSymbolId: number | null,
  stateValue: StaticEffectStateValue | null,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
  additionalStateValues: ReadonlyMap<number, StaticEffectStateValue> = new Map(),
): StaticEffectStateValue | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Literal")) {
    const literalValue = unwrappedExpression.value;
    if (
      literalValue === null ||
      typeof literalValue === "boolean" ||
      typeof literalValue === "number" ||
      typeof literalValue === "string"
    ) {
      return { value: literalValue };
    }
    return null;
  }
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(unwrappedExpression);
    if (symbol?.id === stateSymbolId) return stateValue;
    if (symbol && additionalStateValues.has(symbol.id)) {
      return additionalStateValues.get(symbol.id) ?? null;
    }
    if (unwrappedExpression.name === "undefined" && scopes.isGlobalReference(unwrappedExpression)) {
      return { value: undefined };
    }
    if (unwrappedExpression.name === "NaN" && scopes.isGlobalReference(unwrappedExpression)) {
      return { value: Number.NaN };
    }
    const immutableSymbol = scopes.symbolFor(unwrappedExpression);
    if (
      immutableSymbol?.kind !== "const" ||
      !immutableSymbol.initializer ||
      !isNodeOfType(immutableSymbol.declarationNode, "VariableDeclarator") ||
      immutableSymbol.declarationNode.id !== immutableSymbol.bindingIdentifier ||
      immutableSymbol.declarationNode.init !== immutableSymbol.initializer ||
      immutableSymbol.references.some((reference) => reference.flag !== "read") ||
      visitedSymbolIds.has(immutableSymbol.id)
    ) {
      return null;
    }
    return readStaticEffectValue(
      immutableSymbol.initializer,
      scopes,
      stateSymbolId,
      stateValue,
      new Set(visitedSymbolIds).add(immutableSymbol.id),
      additionalStateValues,
    );
  }
  if (isNodeOfType(unwrappedExpression, "UnaryExpression")) {
    if (unwrappedExpression.operator === "void") return { value: undefined };
    if (unwrappedExpression.operator !== "!") return null;
    const argumentValue = readStaticEffectValue(
      unwrappedExpression.argument,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
      additionalStateValues,
    );
    return argumentValue ? { value: !argumentValue.value } : null;
  }
  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    if (
      isNodeOfType(unwrappedExpression.callee, "Identifier") &&
      unwrappedExpression.callee.name === "Boolean" &&
      scopes.isGlobalReference(unwrappedExpression.callee) &&
      unwrappedExpression.arguments.length === 1 &&
      unwrappedExpression.arguments[0] &&
      !isNodeOfType(unwrappedExpression.arguments[0], "SpreadElement")
    ) {
      const argumentValue = readStaticEffectValue(
        unwrappedExpression.arguments[0],
        scopes,
        stateSymbolId,
        stateValue,
        visitedSymbolIds,
        additionalStateValues,
      );
      return argumentValue ? { value: Boolean(argumentValue.value) } : null;
    }
    return null;
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    const leftValue = readStaticEffectValue(
      unwrappedExpression.left,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
      additionalStateValues,
    );
    if (!leftValue) return null;
    if (unwrappedExpression.operator === "&&" && !leftValue.value) return leftValue;
    if (unwrappedExpression.operator === "||" && leftValue.value) return leftValue;
    if (
      unwrappedExpression.operator === "??" &&
      leftValue.value !== null &&
      leftValue.value !== undefined
    ) {
      return leftValue;
    }
    return readStaticEffectValue(
      unwrappedExpression.right,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
      additionalStateValues,
    );
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    const testValue = readStaticEffectValue(
      unwrappedExpression.test,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
      additionalStateValues,
    );
    if (!testValue) return null;
    return readStaticEffectValue(
      testValue.value ? unwrappedExpression.consequent : unwrappedExpression.alternate,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
      additionalStateValues,
    );
  }
  if (isNodeOfType(unwrappedExpression, "MemberExpression") && unwrappedExpression.optional) {
    const objectValue = readStaticEffectValue(
      unwrappedExpression.object,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
      additionalStateValues,
    );
    if (objectValue?.value === null || objectValue?.value === undefined) {
      return { value: undefined };
    }
    return null;
  }
  if (isNodeOfType(unwrappedExpression, "BinaryExpression")) {
    const leftValue = readStaticEffectValue(
      unwrappedExpression.left,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
      additionalStateValues,
    );
    const rightValue = readStaticEffectValue(
      unwrappedExpression.right,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
      additionalStateValues,
    );
    if (!leftValue || !rightValue) return null;
    if (unwrappedExpression.operator === "===" || unwrappedExpression.operator === "!==") {
      const areEqual = leftValue.value === rightValue.value;
      return { value: unwrappedExpression.operator === "===" ? areEqual : !areEqual };
    }
    if (unwrappedExpression.operator === "==" || unwrappedExpression.operator === "!=") {
      const isLeftNullish = leftValue.value === null || leftValue.value === undefined;
      const isRightNullish = rightValue.value === null || rightValue.value === undefined;
      if (!isLeftNullish && !isRightNullish && typeof leftValue.value !== typeof rightValue.value) {
        return null;
      }
      const areEqual =
        isLeftNullish || isRightNullish
          ? isLeftNullish && isRightNullish
          : leftValue.value === rightValue.value;
      return { value: unwrappedExpression.operator === "==" ? areEqual : !areEqual };
    }
  }
  return null;
};

const readStaticUpdaterReturnValue = (
  updater: EsTreeNode,
  scopes: ScopeAnalysis,
): StaticEffectStateValue | null => {
  if (!isFunctionLike(updater) || updater.async || updater.generator) return null;
  if (!isNodeOfType(updater.body, "BlockStatement")) {
    return readStaticEffectValue(updater.body, scopes, null, null);
  }
  if (updater.body.body.length === 0) return { value: undefined };
  if (updater.body.body.length !== 1) return null;
  const returnStatement = updater.body.body[0];
  if (!isNodeOfType(returnStatement, "ReturnStatement")) return null;
  if (!returnStatement.argument) return { value: undefined };
  return readStaticEffectValue(returnStatement.argument, scopes, null, null);
};

const readStaticSetterValue = (
  setterCall: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): StaticEffectStateValue | null => {
  const argument = setterCall.arguments[0];
  if (!argument) return { value: undefined };
  if (isNodeOfType(argument, "SpreadElement")) return null;
  const updater = resolveExactLocalFunction(argument, scopes);
  if (updater) return readStaticUpdaterReturnValue(updater, scopes);
  return readStaticEffectValue(argument, scopes, null, null);
};

// HACK: only count setter calls that actually run during the effect's
// synchronous body. A `setX` inside `setTimeout(() => setX(...))` or
// `.then(() => setX(...))` is a DEFERRED write — by the time it fires,
// the chain reader effect has already had its dep-update window. Treat
// only direct (non-nested-function) writes as chain triggers; that
// stops `noEffectChain` from over-flagging the dominant debounce /
// async-fetch shape that real codebases use.
const collectStateWritesInEffect = (
  analysisFunctions: ReadonlySet<EsTreeNode>,
  setterSymbolIdToStateName: ReadonlyMap<number, string>,
  scopes: ScopeAnalysis,
): Map<string, EffectStateWriteInfo> => {
  const stateWrites = new Map<string, EffectStateWriteInfo>();
  visitSynchronousFunctionBodies(analysisFunctions, (child) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    const stateName = getStateNameForSetterCall(child, setterSymbolIdToStateName, scopes);
    if (!stateName) return;
    const writeInfo = stateWrites.get(stateName) ?? {
      values: new Set<boolean | number | string | null | undefined>(),
      hasUnknownValue: false,
    };
    const staticValue = readStaticSetterValue(child, scopes);
    if (staticValue) writeInfo.values.add(staticValue.value);
    else writeInfo.hasUnknownValue = true;
    stateWrites.set(stateName, writeInfo);
  });
  return stateWrites;
};

const isGlobalBooleanCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  return (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "Boolean" &&
    scopes.isGlobalReference(node.callee)
  );
};

const isWorkNodeReachableForStateValue = (
  workNode: EsTreeNode,
  stateSymbolId: number,
  stateValue: StaticEffectStateValue,
  scopes: ScopeAnalysis,
  additionalStateValues: ReadonlyMap<number, StaticEffectStateValue> = new Map(),
): boolean => {
  let currentNode = workNode;
  while (currentNode.parent) {
    const parentNode: EsTreeNode = currentNode.parent;
    if (isFunctionLike(parentNode)) break;
    if (isNodeOfType(parentNode, "IfStatement")) {
      const testValue = readStaticEffectValue(
        parentNode.test,
        scopes,
        stateSymbolId,
        stateValue,
        new Set(),
        additionalStateValues,
      );
      if (testValue) {
        if (currentNode === parentNode.consequent && !testValue.value) return false;
        if (currentNode === parentNode.alternate && testValue.value) return false;
      }
    }
    if (isNodeOfType(parentNode, "ConditionalExpression")) {
      const testValue = readStaticEffectValue(
        parentNode.test,
        scopes,
        stateSymbolId,
        stateValue,
        new Set(),
        additionalStateValues,
      );
      if (testValue) {
        if (currentNode === parentNode.consequent && !testValue.value) return false;
        if (currentNode === parentNode.alternate && testValue.value) return false;
      }
    }
    if (isNodeOfType(parentNode, "LogicalExpression") && currentNode === parentNode.right) {
      const leftValue = readStaticEffectValue(
        parentNode.left,
        scopes,
        stateSymbolId,
        stateValue,
        new Set(),
        additionalStateValues,
      );
      if (leftValue) {
        if (parentNode.operator === "&&" && !leftValue.value) return false;
        if (parentNode.operator === "||" && leftValue.value) return false;
        if (
          parentNode.operator === "??" &&
          leftValue.value !== null &&
          leftValue.value !== undefined
        ) {
          return false;
        }
      }
    }
    if (isNodeOfType(parentNode, "BlockStatement")) {
      const statementIndex = parentNode.body.findIndex((statement) => statement === currentNode);
      if (statementIndex >= 0) {
        for (let index = 0; index < statementIndex; index += 1) {
          const earlierStatement = parentNode.body[index];
          if (
            !isNodeOfType(earlierStatement, "IfStatement") ||
            earlierStatement.alternate ||
            !statementAlwaysExits(earlierStatement.consequent)
          ) {
            continue;
          }
          const testValue = readStaticEffectValue(
            earlierStatement.test,
            scopes,
            stateSymbolId,
            stateValue,
            new Set(),
            additionalStateValues,
          );
          if (testValue?.value) return false;
        }
      }
    }
    currentNode = parentNode;
  }
  return true;
};

const isReaderWorkNode = (
  node: EsTreeNode,
  analysisFunctions: ReadonlySet<EsTreeNode>,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(node, "CallExpression")) {
    if (isGlobalBooleanCall(node, scopes)) return false;
    const invokedFunction = resolveSynchronouslyInvokedFunction(node.callee, scopes);
    return !invokedFunction || !analysisFunctions.has(invokedFunction);
  }
  return (
    isNodeOfType(node, "AssignmentExpression") ||
    isNodeOfType(node, "UpdateExpression") ||
    isNodeOfType(node, "NewExpression") ||
    isNodeOfType(node, "TaggedTemplateExpression") ||
    isNodeOfType(node, "ThrowStatement") ||
    (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
  );
};

interface ReaderAnalysisFrame {
  functionNode: EsTreeNode;
  parameterStateValues: ReadonlyMap<number, StaticEffectStateValue>;
}

const mergeKnownStateValues = (
  additionalStateValues: ReadonlyMap<number, StaticEffectStateValue>,
  parameterStateValues: ReadonlyMap<number, StaticEffectStateValue>,
): ReadonlyMap<number, StaticEffectStateValue> => {
  if (parameterStateValues.size === 0) return additionalStateValues;
  const knownStateValues = new Map(additionalStateValues);
  for (const [symbolId, value] of parameterStateValues) knownStateValues.set(symbolId, value);
  return knownStateValues;
};

const buildInvokedFunctionParameterStateValues = (
  invokedFunction: EsTreeNode,
  invocation: EsTreeNodeOfType<"CallExpression">,
  stateSymbolId: number,
  stateValue: StaticEffectStateValue,
  scopes: ScopeAnalysis,
  additionalStateValues: ReadonlyMap<number, StaticEffectStateValue> = new Map(),
  callerParameterStateValues: ReadonlyMap<number, StaticEffectStateValue> = new Map(),
): ReadonlyMap<number, StaticEffectStateValue> => {
  if (!isFunctionLike(invokedFunction)) return new Map();
  const parameterStateValues = new Map<number, StaticEffectStateValue>();
  const callerKnownStateValues = mergeKnownStateValues(
    additionalStateValues,
    callerParameterStateValues,
  );
  for (
    let parameterIndex = 0;
    parameterIndex < invokedFunction.params.length;
    parameterIndex += 1
  ) {
    const rawParameter = invokedFunction.params[parameterIndex];
    const rawArgument = invocation.arguments[parameterIndex];
    if (rawArgument && isNodeOfType(rawArgument, "SpreadElement")) break;
    const parameter = isNodeOfType(rawParameter, "AssignmentPattern")
      ? rawParameter.left
      : rawParameter;
    if (!isNodeOfType(parameter, "Identifier")) continue;
    const parameterSymbol = scopes.symbolFor(parameter);
    if (!parameterSymbol) continue;
    let argumentValue: StaticEffectStateValue | null = null;
    if (rawArgument) {
      argumentValue = readStaticEffectValue(
        rawArgument,
        scopes,
        stateSymbolId,
        stateValue,
        new Set(),
        callerKnownStateValues,
      );
      if (
        argumentValue !== null &&
        argumentValue.value === undefined &&
        isNodeOfType(rawParameter, "AssignmentPattern")
      ) {
        const defaultKnownStateValues = mergeKnownStateValues(
          callerKnownStateValues,
          parameterStateValues,
        );
        argumentValue = readStaticEffectValue(
          rawParameter.right,
          scopes,
          stateSymbolId,
          stateValue,
          new Set(),
          defaultKnownStateValues,
        );
      }
    } else if (isNodeOfType(rawParameter, "AssignmentPattern")) {
      const defaultKnownStateValues = mergeKnownStateValues(
        callerKnownStateValues,
        parameterStateValues,
      );
      argumentValue = readStaticEffectValue(
        rawParameter.right,
        scopes,
        stateSymbolId,
        stateValue,
        new Set(),
        defaultKnownStateValues,
      );
    } else {
      argumentValue = { value: undefined };
    }
    if (argumentValue) parameterStateValues.set(parameterSymbol.id, argumentValue);
  }
  return parameterStateValues;
};

const haveEqualParameterStateValues = (
  leftValues: ReadonlyMap<number, StaticEffectStateValue>,
  rightValues: ReadonlyMap<number, StaticEffectStateValue>,
): boolean => {
  if (leftValues.size !== rightValues.size) return false;
  for (const [symbolId, leftValue] of leftValues) {
    const rightValue = rightValues.get(symbolId);
    if (!rightValue || !Object.is(leftValue.value, rightValue.value)) return false;
  }
  return true;
};

const canReaderWorkRunForStateValues = (
  readerEffect: EffectInfo,
  stateSymbolId: number,
  stateValue: StaticEffectStateValue,
  scopes: ScopeAnalysis,
  additionalStateValues: ReadonlyMap<number, StaticEffectStateValue> = new Map(),
): boolean => {
  const pendingFrames: ReaderAnalysisFrame[] = [
    { functionNode: readerEffect.callback, parameterStateValues: new Map() },
  ];
  const visitedParameterStateValues = new Map<
    EsTreeNode,
    ReadonlyMap<number, StaticEffectStateValue>[]
  >();

  while (pendingFrames.length > 0) {
    const frame = pendingFrames.pop();
    if (!frame || !isFunctionLike(frame.functionNode)) continue;
    const functionParameterStateValues = visitedParameterStateValues.get(frame.functionNode) ?? [];
    if (
      functionParameterStateValues.some((previousValues) =>
        haveEqualParameterStateValues(previousValues, frame.parameterStateValues),
      )
    ) {
      continue;
    }
    functionParameterStateValues.push(frame.parameterStateValues);
    visitedParameterStateValues.set(frame.functionNode, functionParameterStateValues);
    const knownStateValues = mergeKnownStateValues(
      additionalStateValues,
      frame.parameterStateValues,
    );
    let didFindReachableWork = false;

    walkInsideStatementBlocks(frame.functionNode.body, (child) => {
      if (didFindReachableWork) return;
      if (isNodeOfType(child, "CallExpression")) {
        const invokedFunction = resolveSynchronouslyInvokedFunction(child.callee, scopes);
        if (invokedFunction && readerEffect.analysisFunctions.has(invokedFunction)) {
          if (
            isWorkNodeReachableForStateValue(
              child,
              stateSymbolId,
              stateValue,
              scopes,
              knownStateValues,
            )
          ) {
            pendingFrames.push({
              functionNode: invokedFunction,
              parameterStateValues: buildInvokedFunctionParameterStateValues(
                invokedFunction,
                child,
                stateSymbolId,
                stateValue,
                scopes,
                additionalStateValues,
                frame.parameterStateValues,
              ),
            });
          }
          return;
        }
      }
      if (
        isReaderWorkNode(child, readerEffect.analysisFunctions, scopes) &&
        isWorkNodeReachableForStateValue(child, stateSymbolId, stateValue, scopes, knownStateValues)
      ) {
        didFindReachableWork = true;
      }
    });
    if (didFindReachableWork) return true;
  }
  return false;
};

const canStateWriteReachReaderWork = (
  writtenStateName: string,
  writerEffect: EffectInfo,
  readerEffect: EffectInfo,
  stateSymbolIds: ReadonlyMap<string, number>,
  scopes: ScopeAnalysis,
): boolean => {
  const writeInfo = writerEffect.stateWrites.get(writtenStateName);
  const stateSymbolId = stateSymbolIds.get(writtenStateName);
  if (!writeInfo || stateSymbolId === undefined) return true;

  if (writeInfo.hasUnknownValue) return true;

  for (const writtenValue of writeInfo.values) {
    if (
      canReaderWorkRunForStateValues(readerEffect, stateSymbolId, { value: writtenValue }, scopes)
    ) {
      return true;
    }
  }
  return false;
};

const EMPTY_CLEANUP_NAME_SET = new Set<string>();
const NON_CONTAMINATING_MAP_METHOD_NAMES = new Set([
  "clear",
  "delete",
  "entries",
  "get",
  "has",
  "keys",
  "values",
]);
const EXTERNAL_SYNC_DIRECT_IMPORT_SOURCES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["fetch", new Set(["cross-fetch", "node-fetch", "undici"])],
  ["ky", new Set(["ky"])],
  ["got", new Set(["got"])],
  ["wretch", new Set(["wretch"])],
  ["ofetch", new Set(["ofetch"])],
  ["setTimeout", new Set(["node:timers", "node:timers/promises", "timers", "timers/promises"])],
  ["setInterval", new Set(["node:timers", "node:timers/promises", "timers", "timers/promises"])],
]);
const EXTERNAL_SYNC_DEFAULT_IMPORT_NAMES: ReadonlyMap<string, string> = new Map([
  ["axios", "axios"],
  ["cross-fetch", "fetch"],
  ["got", "got"],
  ["ky", "ky"],
  ["node-fetch", "fetch"],
  ["wretch", "wretch"],
]);
const EXTERNAL_SYNC_HTTP_CLIENT_MODULE_SOURCES: ReadonlySet<string> = new Set([
  "axios",
  "cross-fetch",
  "got",
  "ky",
  "node-fetch",
  "ofetch",
  "undici",
  "wretch",
]);
const EXTERNAL_SYNC_GLOBAL_HTTP_CLIENT_NAMES: ReadonlySet<string> = new Set([
  "axios",
  "got",
  "ky",
  "ofetch",
  "wretch",
]);
const EXTERNAL_SYNC_HTTP_METHOD_NAMES: ReadonlySet<string> = new Set([
  ...EXTERNAL_SYNC_AMBIGUOUS_HTTP_METHOD_NAMES,
  "fetch",
  "patch",
  "post",
  "put",
  "request",
]);
const TANSTACK_QUERY_CLIENT_MODULE_SOURCES: ReadonlySet<string> = new Set([
  "@tanstack/query-core",
  "@tanstack/react-query",
]);
const TANSTACK_QUERY_EXTERNAL_SYNC_METHOD_NAMES: ReadonlySet<string> = new Set([
  "fetchQuery",
  "prefetchQuery",
]);
const EXTERNAL_SYNC_RESOURCE_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  ...EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS,
  ...SOCKET_CONSTRUCTOR_NAMES_REQUIRING_CLEANUP,
  "EventTarget",
  "XMLHttpRequest",
]);

interface ExternalModuleBinding {
  source: string;
  exportedName: string | null;
  isModuleObject: boolean;
}

const getDestructuredBindingDepth = (bindingIdentifier: EsTreeNode): number => {
  let bindingNode = bindingIdentifier;
  let depth = 0;
  while (true) {
    if (
      isNodeOfType(bindingNode.parent, "AssignmentPattern") &&
      bindingNode.parent.left === bindingNode
    ) {
      bindingNode = bindingNode.parent;
    }
    const property = bindingNode.parent;
    if (
      !property ||
      !isNodeOfType(property, "Property") ||
      property.value !== bindingNode ||
      !property.parent ||
      !isNodeOfType(property.parent, "ObjectPattern")
    ) {
      return depth;
    }
    depth += 1;
    bindingNode = property.parent;
  }
};

const isMutatedMemberExpression = (rawMemberExpression: EsTreeNode): boolean => {
  let expression = findTransparentExpressionRoot(rawMemberExpression);
  while (expression.parent) {
    const parent = expression.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === expression) {
      expression = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "Property") &&
      parent.value === expression &&
      isNodeOfType(parent.parent, "ObjectPattern")
    ) {
      expression = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "ObjectPattern") &&
      parent.properties.some((property) => property === expression)
    ) {
      expression = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "ArrayPattern") &&
      parent.elements.some((element) => element === expression)
    ) {
      expression = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      (isNodeOfType(parent, "RestElement") && parent.argument === expression) ||
      (isNodeOfType(parent, "AssignmentPattern") && parent.left === expression)
    ) {
      expression = findTransparentExpressionRoot(parent);
      continue;
    }
    break;
  }
  const parent = expression.parent;
  return Boolean(
    (isNodeOfType(parent, "AssignmentExpression") && parent.left === expression) ||
    (isNodeOfType(parent, "UpdateExpression") && parent.argument === expression) ||
    (isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "delete" &&
      parent.argument === expression) ||
    ((isNodeOfType(parent, "ForInStatement") || isNodeOfType(parent, "ForOfStatement")) &&
      parent.left === expression),
  );
};

const isReactHookDependencyArgument = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const call = expression.parent;
  return Boolean(
    isNodeOfType(call, "CallExpression") &&
    call.arguments[1] === expression &&
    isReactApiCall(call, HOOKS_WITH_DEPS, scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    }),
  );
};

const isPlainDependencyObjectExpression = (
  expression: EsTreeNode,
): expression is EsTreeNodeOfType<"ObjectExpression"> =>
  isNodeOfType(expression, "ObjectExpression") &&
  expression.properties.every(
    (property) =>
      isNodeOfType(property, "Property") &&
      property.kind === "init" &&
      !property.computed &&
      !property.method,
  );

interface ReactDependencyPath {
  expression: EsTreeNode;
  containerKind: "array" | "object" | null;
}

const getContainingReactDependencyValue = (
  rawExpression: EsTreeNode,
  containerKind: ReactDependencyPath["containerKind"],
): ReactDependencyPath | null => {
  const expression = findTransparentExpressionRoot(rawExpression);
  const parent = expression.parent;
  if (isNodeOfType(parent, "ArrayExpression")) {
    return { expression: parent, containerKind: "array" };
  }
  if (
    containerKind === "array" &&
    isNodeOfType(parent, "SpreadElement") &&
    parent.argument === expression &&
    isNodeOfType(parent.parent, "ArrayExpression")
  ) {
    return { expression: parent.parent, containerKind: "array" };
  }
  if (
    isNodeOfType(parent, "Property") &&
    (parent.value === expression || (parent.shorthand && parent.key === expression)) &&
    parent.parent &&
    isPlainDependencyObjectExpression(parent.parent)
  ) {
    return { expression: parent.parent, containerKind: "object" };
  }
  return null;
};

const getFullArrayRestCopySymbol = (
  initializer: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const declaration = initializer.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== initializer ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== 1
  ) {
    return null;
  }
  const restElement = declaration.id.elements[0];
  if (
    !isNodeOfType(restElement, "RestElement") ||
    !isNodeOfType(restElement.argument, "Identifier")
  ) {
    return null;
  }
  const symbol = scopes.symbolFor(restElement.argument);
  return symbol?.kind === "const" &&
    symbol.declarationNode === declaration &&
    symbol.references.every((reference) => reference.flag === "read")
    ? symbol
    : null;
};

const isReactDependencyArrayReference = (
  initialExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const pendingPaths: ReactDependencyPath[] = [
    { expression: initialExpression, containerKind: null },
  ];
  const visitedExpressions = new Set<EsTreeNode>();
  let didFindReactDependencyArgument = false;

  while (pendingPaths.length > 0) {
    const pendingPath = pendingPaths.pop();
    if (!pendingPath) continue;
    const expression = findTransparentExpressionRoot(pendingPath.expression);
    if (visitedExpressions.has(expression)) continue;
    visitedExpressions.add(expression);

    if (
      pendingPath.containerKind === "array" &&
      isReactHookDependencyArgument(expression, scopes)
    ) {
      didFindReactDependencyArgument = true;
      continue;
    }

    const containingValue = getContainingReactDependencyValue(
      expression,
      pendingPath.containerKind,
    );
    if (containingValue) {
      pendingPaths.push(containingValue);
      continue;
    }

    const declaration = expression.parent;
    if (
      isNodeOfType(declaration, "VariableDeclarator") &&
      declaration.init === expression &&
      isNodeOfType(declaration.id, "Identifier")
    ) {
      const symbol = scopes.symbolFor(declaration.id);
      if (!symbol || getDirectUnreassignedInitializer(symbol) !== expression) return false;
      if (symbol.references.length === 0) return false;
      for (const reference of symbol.references) {
        pendingPaths.push({
          expression: reference.identifier,
          containerKind: pendingPath.containerKind,
        });
      }
      continue;
    }

    if (pendingPath.containerKind === "array") {
      const restCopySymbol = getFullArrayRestCopySymbol(expression, scopes);
      if (restCopySymbol) {
        if (restCopySymbol.references.length === 0) return false;
        for (const reference of restCopySymbol.references) {
          pendingPaths.push({ expression: reference.identifier, containerKind: "array" });
        }
        continue;
      }
    }

    return false;
  }

  return didFindReactDependencyArgument;
};

const hasSafeReceiverAliases = (
  rootSymbols: ReadonlySet<SymbolDescriptor>,
  scopes: ScopeAnalysis,
): boolean => {
  const pendingSymbols = [...rootSymbols];
  const visitedSymbolIds = new Set<number>();
  while (pendingSymbols.length > 0) {
    const symbol = pendingSymbols.pop();
    if (!symbol || visitedSymbolIds.has(symbol.id)) continue;
    visitedSymbolIds.add(symbol.id);
    for (const reference of symbol.references) {
      const expression = findTransparentExpressionRoot(reference.identifier);
      const container = expression.parent;
      if (isReactDependencyArrayReference(expression, scopes)) continue;
      if (isNodeOfType(container, "MemberExpression") && container.object === expression) {
        if (isMutatedMemberExpression(container)) return false;
        continue;
      }
      if (isNodeOfType(container, "CallExpression") && container.callee === expression) continue;
      if (
        isNodeOfType(container, "VariableDeclarator") &&
        container.init === expression &&
        isNodeOfType(container.id, "ObjectPattern")
      ) {
        continue;
      }
      if (
        isNodeOfType(container, "AssignmentExpression") &&
        container.right === expression &&
        isNodeOfType(container.left, "ObjectPattern")
      ) {
        continue;
      }
      if (
        isNodeOfType(container, "VariableDeclarator") &&
        container.init === expression &&
        isNodeOfType(container.id, "Identifier")
      ) {
        const aliasSymbol = scopes.symbolFor(container.id);
        const aliasInitializer = aliasSymbol && getDirectUnreassignedInitializer(aliasSymbol);
        if (!aliasSymbol || aliasInitializer !== expression) return false;
        pendingSymbols.push(aliasSymbol);
        continue;
      }
      return false;
    }
  }
  return true;
};

const hasProvenGlobalNamespaceReference = (
  expression: EsTreeNode,
  namespaceNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  for (const namespaceName of namespaceNames) {
    if (isProvenGlobalNamespaceReference(expression, namespaceName, scopes)) return true;
  }
  return false;
};

const getTypeScriptImportEqualsSource = (symbol: SymbolDescriptor): string | null => {
  if (
    symbol.kind !== "ts-import-equals" ||
    !isNodeOfType(symbol.declarationNode, "TSImportEqualsDeclaration")
  ) {
    return null;
  }
  const moduleReference = symbol.declarationNode.moduleReference;
  if (
    !isNodeOfType(moduleReference, "TSExternalModuleReference") ||
    !isNodeOfType(moduleReference.expression, "Literal")
  ) {
    return null;
  }
  return typeof moduleReference.expression.value === "string"
    ? moduleReference.expression.value
    : null;
};

const getUnshadowedRequireSource = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  let expression = stripParenExpression(rawExpression);
  while (isNodeOfType(expression, "MemberExpression")) {
    expression = stripParenExpression(expression.object);
  }
  if (
    !isNodeOfType(expression, "CallExpression") ||
    !isNodeOfType(expression.callee, "Identifier") ||
    expression.callee.name !== "require" ||
    !scopes.isGlobalReference(expression.callee)
  ) {
    return null;
  }
  return getRequireCallSource(rawExpression);
};

const resolveExternalModuleBinding = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
  ignoreCommonJsMutation = false,
): ExternalModuleBinding | null => {
  let expression = stripParenExpression(rawExpression);
  let outermostExportedName: string | null = null;
  let exportedPropertyDepth = 0;
  let resolvedBinding: ExternalModuleBinding | null = null;
  let isCommonJsModuleObject = false;
  const traversedSymbolIds = new Set(visitedSymbolIds);
  const commonJsModuleObjectSymbols = new Set<SymbolDescriptor>();

  while (true) {
    if (isNodeOfType(expression, "MemberExpression")) {
      const propertyName = getStaticPropertyName(expression);
      if (propertyName === null) return null;
      outermostExportedName ??= propertyName;
      exportedPropertyDepth += 1;
      expression = stripParenExpression(expression.object);
      continue;
    }
    const requireSource = getUnshadowedRequireSource(expression, scopes);
    if (requireSource !== null) {
      resolvedBinding = { source: requireSource, exportedName: null, isModuleObject: true };
      isCommonJsModuleObject = true;
      break;
    }
    if (!isNodeOfType(expression, "Identifier")) return null;
    const symbol = scopes.symbolFor(expression);
    if (!symbol || traversedSymbolIds.has(symbol.id)) return null;
    if (symbol.kind === "import") {
      const importDeclaration = symbol.declarationNode.parent;
      if (
        !importDeclaration ||
        !isNodeOfType(importDeclaration, "ImportDeclaration") ||
        typeof importDeclaration.source.value !== "string"
      ) {
        return null;
      }
      if (isNodeOfType(symbol.declarationNode, "ImportSpecifier")) {
        resolvedBinding = {
          source: importDeclaration.source.value,
          exportedName: getImportedName(symbol.declarationNode) ?? null,
          isModuleObject: false,
        };
      } else if (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")) {
        resolvedBinding = {
          source: importDeclaration.source.value,
          exportedName: "default",
          isModuleObject: false,
        };
      } else if (isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) {
        resolvedBinding = {
          source: importDeclaration.source.value,
          exportedName: null,
          isModuleObject: true,
        };
      }
      break;
    }
    const importEqualsSource = getTypeScriptImportEqualsSource(symbol);
    if (importEqualsSource !== null) {
      resolvedBinding = { source: importEqualsSource, exportedName: null, isModuleObject: true };
      isCommonJsModuleObject = true;
      commonJsModuleObjectSymbols.add(symbol);
      break;
    }
    const directInitializer = getDirectUnreassignedInitializer(symbol);
    const destructuredPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
    const initializer =
      directInitializer ??
      (destructuredPropertyName !== null &&
      symbol.kind === "const" &&
      isNodeOfType(symbol.declarationNode, "VariableDeclarator")
        ? symbol.declarationNode.init
        : null);
    if (!initializer) return null;
    traversedSymbolIds.add(symbol.id);
    outermostExportedName ??= destructuredPropertyName;
    if (destructuredPropertyName !== null) {
      exportedPropertyDepth += getDestructuredBindingDepth(symbol.bindingIdentifier);
    }
    const unwrappedInitializer = stripParenExpression(initializer);
    if (
      destructuredPropertyName === null &&
      !isNodeOfType(unwrappedInitializer, "MemberExpression")
    ) {
      commonJsModuleObjectSymbols.add(symbol);
    }
    expression = unwrappedInitializer;
  }

  if (!resolvedBinding) return null;
  if (
    !ignoreCommonJsMutation &&
    isCommonJsModuleObject &&
    !hasSafeReceiverAliases(commonJsModuleObjectSymbols, scopes)
  ) {
    return null;
  }
  if (outermostExportedName === null) return resolvedBinding;
  if (!resolvedBinding.isModuleObject || exportedPropertyDepth !== 1) return null;
  return {
    source: resolvedBinding.source,
    exportedName: outermostExportedName,
    isModuleObject: false,
  };
};

const getCanonicalExternalSyncExportName = (binding: ExternalModuleBinding): string | null => {
  if (binding.exportedName && binding.exportedName !== "default") return binding.exportedName;
  return EXTERNAL_SYNC_DEFAULT_IMPORT_NAMES.get(binding.source) ?? null;
};

const isKnownExternalSyncDirectModuleBinding = (binding: ExternalModuleBinding): boolean => {
  const exportedName = getCanonicalExternalSyncExportName(binding);
  return Boolean(
    exportedName && EXTERNAL_SYNC_DIRECT_IMPORT_SOURCES.get(exportedName)?.has(binding.source),
  );
};
const DEFINITELY_NON_FUNCTION_GLOBAL_CALL_NAMES = new Set([
  "Array",
  "BigInt",
  "Boolean",
  "Date",
  "Number",
  "String",
  "Symbol",
]);
const DEFINITELY_NON_FUNCTION_GLOBAL_CONSTRUCTOR_NAMES = new Set([
  "Array",
  "Boolean",
  "Date",
  "Map",
  "Number",
  "Promise",
  "RegExp",
  "Set",
  "String",
  "URL",
  "URLSearchParams",
  "WeakMap",
  "WeakSet",
]);
const PROMISE_STATIC_RESULT_METHOD_NAMES = new Set([
  "all",
  "allSettled",
  "any",
  "race",
  "reject",
  "resolve",
  "withResolvers",
]);

const returnsOnlyNonCleanupValues = (
  functionNode: EsTreeNode,
  setterToStateName: ReadonlyMap<string, string>,
  scopes: ScopeAnalysis,
  visitedFunctions: ReadonlySet<EsTreeNode> = new Set(),
): boolean => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    visitedFunctions.has(functionNode)
  ) {
    return false;
  }
  const nextVisitedFunctions = new Set(visitedFunctions).add(functionNode);
  const isNonCleanupValue = (returnValue: EsTreeNode): boolean => {
    const expression = stripParenExpression(returnValue);
    if (
      isNodeOfType(expression, "Identifier") &&
      expression.name === "undefined" &&
      scopes.isGlobalReference(expression)
    ) {
      return true;
    }
    if (
      isNodeOfType(expression, "Literal") ||
      isNodeOfType(expression, "ArrayExpression") ||
      isNodeOfType(expression, "ObjectExpression") ||
      isNodeOfType(expression, "JSXElement") ||
      isNodeOfType(expression, "JSXFragment") ||
      isNodeOfType(expression, "TemplateLiteral") ||
      (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void")
    ) {
      return true;
    }
    if (isNodeOfType(expression, "ConditionalExpression")) {
      return isNonCleanupValue(expression.consequent) && isNonCleanupValue(expression.alternate);
    }
    if (isNodeOfType(expression, "LogicalExpression")) {
      return isNonCleanupValue(expression.left) && isNonCleanupValue(expression.right);
    }
    if (isNodeOfType(expression, "SequenceExpression")) {
      const finalExpression = expression.expressions.at(-1);
      return Boolean(finalExpression && isNonCleanupValue(finalExpression));
    }
    if (
      isNodeOfType(expression, "NewExpression") &&
      isNodeOfType(expression.callee, "Identifier") &&
      DEFINITELY_NON_FUNCTION_GLOBAL_CONSTRUCTOR_NAMES.has(expression.callee.name) &&
      scopes.isGlobalReference(expression.callee)
    ) {
      return true;
    }
    if (!isNodeOfType(expression, "CallExpression")) return false;
    if (
      isNodeOfType(expression.callee, "Identifier") &&
      DEFINITELY_NON_FUNCTION_GLOBAL_CALL_NAMES.has(expression.callee.name) &&
      scopes.isGlobalReference(expression.callee)
    ) {
      return true;
    }
    if (
      isNodeOfType(expression.callee, "MemberExpression") &&
      isNodeOfType(expression.callee.object, "Identifier") &&
      expression.callee.object.name === "Promise" &&
      scopes.isGlobalReference(expression.callee.object) &&
      PROMISE_STATIC_RESULT_METHOD_NAMES.has(getStaticPropertyName(expression.callee) ?? "")
    ) {
      return true;
    }
    if (
      isNodeOfType(expression.callee, "Identifier") &&
      setterToStateName.has(expression.callee.name)
    ) {
      return true;
    }
    const invokedFunction = resolveSynchronouslyInvokedFunction(expression.callee, scopes);
    return Boolean(
      invokedFunction &&
      returnsOnlyNonCleanupValues(invokedFunction, setterToStateName, scopes, nextVisitedFunctions),
    );
  };

  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    return isNonCleanupValue(functionNode.body);
  }

  let returnsOnlyNonCleanup = true;
  walkAst(functionNode.body, (child: EsTreeNode) => {
    if (!returnsOnlyNonCleanup) return false;
    if (child !== functionNode.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement")) return;
    if (child.argument && !isNonCleanupValue(child.argument)) {
      returnsOnlyNonCleanup = false;
      return false;
    }
  });
  return returnsOnlyNonCleanup;
};

interface CleanupReturnProof {
  hasCleanup: boolean;
  isValid: boolean;
}

const getResolvedFunctionCleanupReturnProof = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedFunctions: ReadonlySet<EsTreeNode> = new Set(),
): CleanupReturnProof => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    visitedFunctions.has(functionNode)
  ) {
    return { hasCleanup: false, isValid: false };
  }
  const nextVisitedFunctions = new Set(visitedFunctions).add(functionNode);
  const getCleanupReturnProof = (returnValue: EsTreeNode): CleanupReturnProof => {
    const expression = stripParenExpression(returnValue);
    if (
      isNodeOfType(expression, "ArrowFunctionExpression") ||
      isNodeOfType(expression, "FunctionExpression")
    ) {
      return { hasCleanup: true, isValid: true };
    }
    if (isNodeOfType(expression, "Identifier")) {
      if (expression.name === "undefined" && scopes.isGlobalReference(expression)) {
        return { hasCleanup: false, isValid: true };
      }
      const localFunction = resolveExactLocalFunction(expression, scopes);
      return { hasCleanup: Boolean(localFunction), isValid: Boolean(localFunction) };
    }
    if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
      return { hasCleanup: false, isValid: true };
    }
    if (isNodeOfType(expression, "ConditionalExpression")) {
      const consequentProof = getCleanupReturnProof(expression.consequent);
      const alternateProof = getCleanupReturnProof(expression.alternate);
      return {
        hasCleanup: consequentProof.hasCleanup || alternateProof.hasCleanup,
        isValid: consequentProof.isValid && alternateProof.isValid,
      };
    }
    if (isNodeOfType(expression, "LogicalExpression")) {
      const leftProof = getCleanupReturnProof(expression.left);
      const rightProof = getCleanupReturnProof(expression.right);
      return {
        hasCleanup: leftProof.hasCleanup || rightProof.hasCleanup,
        isValid: leftProof.isValid && rightProof.isValid,
      };
    }
    if (isNodeOfType(expression, "SequenceExpression")) {
      const finalExpression = expression.expressions.at(-1);
      return finalExpression
        ? getCleanupReturnProof(finalExpression)
        : { hasCleanup: false, isValid: false };
    }
    if (!isNodeOfType(expression, "CallExpression")) {
      return { hasCleanup: false, isValid: false };
    }
    const invokedFunction = resolveSynchronouslyInvokedFunction(expression.callee, scopes);
    return invokedFunction
      ? getResolvedFunctionCleanupReturnProof(invokedFunction, scopes, nextVisitedFunctions)
      : { hasCleanup: false, isValid: false };
  };

  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    return getCleanupReturnProof(functionNode.body);
  }

  let cleanupReturnProof: CleanupReturnProof = { hasCleanup: false, isValid: true };
  walkAst(functionNode.body, (child: EsTreeNode) => {
    if (!cleanupReturnProof.isValid) return false;
    if (child !== functionNode.body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement")) return;
    if (!child.argument) return;
    const returnProof = getCleanupReturnProof(child.argument);
    if (!returnProof.isValid) {
      cleanupReturnProof = { hasCleanup: false, isValid: false };
      return false;
    }
    cleanupReturnProof.hasCleanup ||= returnProof.hasCleanup;
  });
  return cleanupReturnProof;
};

// HACK: a useEffect cleanup return value MUST be a function (or
// undefined). Anything else is either user error or "I'm using
// `return` for early-exit, not for cleanup". For the chain detector,
// we treat only function-shaped returns as "this effect owns an
// external resource" — bare literals (`return null`, `return 0`) and
// state reads (`return foo`) get ignored so they don't silently
// disable chain detection.
const isFunctionShapedReturn = (
  returnedValue: EsTreeNode,
  setterToStateName: ReadonlyMap<string, string>,
  setterSymbolIdToStateName: ReadonlyMap<number, string>,
  scopes: ScopeAnalysis,
  isExplicitReturnStatement: boolean,
): boolean => {
  const unwrappedReturnedValue = stripParenExpression(returnedValue);
  if (
    isNodeOfType(unwrappedReturnedValue, "ArrowFunctionExpression") ||
    isNodeOfType(unwrappedReturnedValue, "FunctionExpression")
  ) {
    return true;
  }
  // Returning a CallExpression result — most cleanup-returning
  // primitives (subscribe, addEventListener helpers) return a
  // function. An explicit `return helper()` statement keeps the
  // opaque-cleanup benefit of the doubt; a concise arrow's implicit
  // return (`useEffect(() => helper(x), [x])`) is usually just a call,
  // not a cleanup contract, so it must prove itself. A proven local
  // state write (`return setSource(1)`) is never cleanup.
  if (isNodeOfType(unwrappedReturnedValue, "CallExpression")) {
    if (isNodeOfType(unwrappedReturnedValue.callee, "Identifier")) {
      const setterSymbol = resolveConstIdentifierAlias(unwrappedReturnedValue.callee, scopes, true);
      if (
        setterToStateName.has(unwrappedReturnedValue.callee.name) ||
        (setterSymbol && setterSymbolIdToStateName.has(setterSymbol.id))
      ) {
        return false;
      }
    }
    const invokedFunction = resolveSynchronouslyInvokedFunction(
      unwrappedReturnedValue.callee,
      scopes,
    );
    if (
      invokedFunction &&
      returnsOnlyNonCleanupValues(invokedFunction, setterToStateName, scopes)
    ) {
      return false;
    }
    if (invokedFunction) {
      const cleanupReturnProof = getResolvedFunctionCleanupReturnProof(invokedFunction, scopes);
      if (cleanupReturnProof.isValid) return cleanupReturnProof.hasCleanup;
    }
    if (
      !invokedFunction &&
      isNodeOfType(unwrappedReturnedValue.callee, "Identifier") &&
      isSetterIdentifier(unwrappedReturnedValue.callee.name)
    ) {
      return true;
    }
    return isCleanupReturn(unwrappedReturnedValue, EMPTY_CLEANUP_NAME_SET, EMPTY_CLEANUP_NAME_SET, {
      allowOpaqueReturn: isExplicitReturnStatement,
    });
  }
  // Returning a bare Identifier — could be the unsub binding from a
  // `const unsub = subscribe(...)` line. We can't statically prove
  // it's function-typed without scope analysis, but in idiomatic React
  // this is the dominant cleanup pattern. Accept.
  if (isNodeOfType(unwrappedReturnedValue, "Identifier")) return true;
  return false;
};

// `localStorage.setItem(...)` / `sessionStorage.getItem(...)` — browser
// storage IS an external system (react.dev's own external-sync example),
// but the member-method constants missed it (docs-validation r2
// docMismatch: Security.jsx device-preference persistence). Covers the
// bare global and the `window.localStorage` spelling.
const STORAGE_GLOBAL_NAMES: ReadonlyArray<string> = ["localStorage", "sessionStorage"];

const isBrowserStorageReceiver = (
  receiver: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(
    receiver &&
    STORAGE_GLOBAL_NAMES.some((storageName) =>
      isProvenGlobalNamespaceReference(receiver, storageName, scopes),
    ),
  );

// `const [tableState, setTableState] = useLocalStorage(...)` — the
// setter persists to browser storage, so an effect whose job is calling
// it synchronizes with an external system exactly like a direct
// `localStorage.setItem` (docs-validation r2: tracecat data-table
// persistence effect).
const STORAGE_HOOK_PATTERN = /^use\w*Storage/i;

const collectStorageHookSetterNames = (componentBody: EsTreeNode): Set<string> => {
  const setterNames = new Set<string>();
  if (!isNodeOfType(componentBody, "BlockStatement")) return setterNames;
  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
      if (!isNodeOfType(declarator.init, "CallExpression")) continue;
      const calleeName = getCalleeName(declarator.init);
      if (!calleeName || !STORAGE_HOOK_PATTERN.test(calleeName)) continue;
      for (const element of declarator.id.elements ?? []) {
        if (isNodeOfType(element, "Identifier") && isSetterIdentifier(element.name)) {
          setterNames.add(element.name);
        }
      }
    }
  }
  return setterNames;
};

const callsStorageHookSetter = (
  analysisFunctions: ReadonlySet<EsTreeNode>,
  storageSetterNames: ReadonlySet<string>,
): boolean => {
  if (storageSetterNames.size === 0) return false;
  let didFindStorageSetterCall = false;
  visitSynchronousFunctionBodies(analysisFunctions, (child) => {
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      storageSetterNames.has(child.callee.name)
    ) {
      didFindStorageSetterCall = true;
    }
  });
  return didFindStorageSetterCall;
};

// A set*-named call that resolves to no local useState setter usually
// synchronizes an external store (a context or prop setter such as
// `setAutoPlaying`). The bare name is a weak signal, so it only exempts
// effects that write no proven-local state — otherwise a prop setter
// would silence a provable chain, and a local set*-named wrapper (whose
// useState writes already count through the analysis functions) would
// flip the verdict on a rename.
const callsOpaqueExternalSetter = (
  analysisFunctions: ReadonlySet<EsTreeNode>,
  setterToStateName: ReadonlyMap<string, string>,
): boolean => {
  let didFindOpaqueSetterCall = false;
  visitSynchronousFunctionBodies(analysisFunctions, (child) => {
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      isSetterIdentifier(child.callee.name) &&
      !setterToStateName.has(child.callee.name)
    ) {
      didFindOpaqueSetterCall = true;
    }
  });
  return didFindOpaqueSetterCall;
};

const isReactUseRefCall = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(expression, "CallExpression") &&
  isReactApiCall(expression, "useRef", scopes, {
    allowGlobalReactNamespace: true,
    allowUnboundBareCalls: true,
    resolveNamedAliases: true,
  });

const isReactRefCall = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isReactUseRefCall(expression, scopes) ||
  (isNodeOfType(expression, "CallExpression") &&
    isReactApiCall(expression, "createRef", scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    }));

const isReactNativeJsxElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return false;
  const symbol = scopes.symbolFor(openingElement.name);
  const importDeclaration = symbol?.declarationNode.parent;
  return Boolean(
    symbol?.kind === "import" &&
    importDeclaration &&
    isNodeOfType(importDeclaration, "ImportDeclaration") &&
    importDeclaration.source.value === "react-native",
  );
};

const isDirectHostJsxRef = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  let didFindHostRef = false;
  const visitedSymbolIds = new Set<number>();
  const pendingSymbols = [symbol];
  while (pendingSymbols.length > 0) {
    const currentSymbol = pendingSymbols.pop();
    if (!currentSymbol || visitedSymbolIds.has(currentSymbol.id)) continue;
    visitedSymbolIds.add(currentSymbol.id);
    for (const reference of currentSymbol.references) {
      const expression = findTransparentExpressionRoot(reference.identifier);
      const container = expression.parent;
      if (
        isNodeOfType(container, "MemberExpression") &&
        container.object === expression &&
        getStaticPropertyName(container) === "current"
      ) {
        continue;
      }
      if (
        isNodeOfType(container, "VariableDeclarator") &&
        container.init === expression &&
        isNodeOfType(container.id, "Identifier")
      ) {
        const aliasSymbol = scopes.symbolFor(container.id);
        const aliasInitializer = aliasSymbol && getDirectUnreassignedInitializer(aliasSymbol);
        if (!aliasSymbol || aliasInitializer !== expression) return false;
        pendingSymbols.push(aliasSymbol);
        continue;
      }
      if (
        !container ||
        !isNodeOfType(container, "JSXExpressionContainer") ||
        container.expression !== expression
      ) {
        return false;
      }
      const attribute = container.parent;
      if (
        !attribute ||
        !isNodeOfType(attribute, "JSXAttribute") ||
        getJsxAttributeName(attribute.name) !== "ref"
      ) {
        return false;
      }
      const openingElement = attribute.parent;
      if (
        !openingElement ||
        !isNodeOfType(openingElement, "JSXOpeningElement") ||
        (!isProvenIntrinsicJsxElement(openingElement, scopes) &&
          !isReactNativeJsxElement(openingElement, scopes))
      ) {
        return false;
      }
      didFindHostRef = true;
    }
  }
  return didFindHostRef;
};

const isIntrinsicRefCallbackParameter = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const identifier = stripParenExpression(expression);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const callback = findEnclosingFunction(identifier);
  if (!callback || !isFunctionLike(callback) || !isInlineIntrinsicRefCallback(callback, scopes)) {
    return false;
  }
  const rawFirstParameter = callback.params?.[0];
  const firstParameter = isNodeOfType(rawFirstParameter, "AssignmentPattern")
    ? rawFirstParameter.left
    : rawFirstParameter;
  const symbol = scopes.symbolFor(identifier);
  return Boolean(
    firstParameter &&
    symbol?.bindingIdentifier === firstParameter &&
    symbol.references.every((reference) => {
      if (reference.flag !== "read") return false;
      let referenceRoot = reference.identifier;
      while (referenceRoot.parent) {
        const parent = referenceRoot.parent;
        if (isNodeOfType(parent, "AssignmentExpression")) {
          return parent.left !== referenceRoot;
        }
        if (isNodeOfType(parent, "UpdateExpression")) {
          return parent.argument !== referenceRoot;
        }
        if (isNodeOfType(parent, "ForInStatement") || isNodeOfType(parent, "ForOfStatement")) {
          return parent.left !== referenceRoot;
        }
        referenceRoot = parent;
      }
      return true;
    }),
  );
};

const getDirectReactRefCall = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const initializer = getDirectUnreassignedInitializer(symbol);
  if (!initializer) return null;
  const expression = stripParenExpression(initializer);
  return isNodeOfType(expression, "CallExpression") && isReactRefCall(expression, scopes)
    ? expression
    : null;
};

const isEmptyGlobalMapConstruction = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = stripParenExpression(rawExpression);
  return (
    isNodeOfType(expression, "NewExpression") &&
    isNodeOfType(expression.callee, "Identifier") &&
    expression.callee.name === "Map" &&
    scopes.isGlobalReference(expression.callee) &&
    expression.arguments.length === 0
  );
};

const hasEmptyRefSentinelInitializer = (
  refCall: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isReactUseRefCall(refCall, scopes) || refCall.arguments.length > 1) return false;
  const [initialValue] = refCall.arguments;
  return (
    !initialValue ||
    (isNodeOfType(initialValue, "Literal") && initialValue.value === null) ||
    (isNodeOfType(initialValue, "Identifier") &&
      initialValue.name === "undefined" &&
      scopes.isGlobalReference(initialValue))
  );
};

const isDirectLazyEmptyMapInitialization = (
  currentExpression: EsTreeNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const assignment = currentExpression.parent;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.left !== currentExpression ||
    assignment.operator !== "??=" ||
    !isEmptyGlobalMapConstruction(assignment.right, scopes)
  ) {
    return false;
  }
  const refOwner = findEnclosingFunction(symbol.bindingIdentifier);
  return refOwner !== null && findEnclosingFunction(assignment) === refOwner;
};

const storesOnlyIntrinsicRefCallbackValues = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const refCall = getDirectReactRefCall(symbol, scopes);
  const initialValue = refCall?.arguments[0];
  const hasDirectEmptyMapInitializer = Boolean(
    initialValue && isEmptyGlobalMapConstruction(initialValue, scopes),
  );
  const hasLazyEmptyMapInitializer = Boolean(
    refCall && hasEmptyRefSentinelInitializer(refCall, scopes),
  );
  if (!hasDirectEmptyMapInitializer && !hasLazyEmptyMapInitializer) {
    return false;
  }

  let intrinsicValueWriteCount = 0;
  let lazyEmptyMapInitializationCount = 0;
  for (const reference of symbol.references) {
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const currentMember = identifier.parent;
    if (
      !isNodeOfType(currentMember, "MemberExpression") ||
      currentMember.object !== identifier ||
      getStaticPropertyName(currentMember) !== "current"
    ) {
      return false;
    }
    const currentExpression = findTransparentExpressionRoot(currentMember);
    if (
      hasLazyEmptyMapInitializer &&
      isDirectLazyEmptyMapInitialization(currentExpression, symbol, scopes)
    ) {
      lazyEmptyMapInitializationCount += 1;
      continue;
    }
    const methodMember = currentExpression.parent;
    if (
      !isNodeOfType(methodMember, "MemberExpression") ||
      methodMember.object !== currentExpression
    ) {
      return false;
    }
    const methodName = getStaticPropertyName(methodMember);
    if (methodName === "size") continue;
    const call = methodMember.parent;
    if (!isNodeOfType(call, "CallExpression") || call.callee !== methodMember) return false;
    if (methodName && NON_CONTAMINATING_MAP_METHOD_NAMES.has(methodName)) continue;
    if (methodName !== "set") return false;
    const storedValue = call.arguments[1];
    if (
      !storedValue ||
      isNodeOfType(storedValue, "SpreadElement") ||
      !isIntrinsicRefCallbackParameter(storedValue, scopes)
    ) {
      return false;
    }
    intrinsicValueWriteCount += 1;
  }
  return (
    intrinsicValueWriteCount > 0 &&
    (hasDirectEmptyMapInitializer || lazyEmptyMapInitializationCount === 1)
  );
};

const isDerivedFromProvenDomRefCurrent = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  didReadCollectionValue = false,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) return false;
    visitedSymbolIds.add(symbol.id);
    return isDerivedFromProvenDomRefCurrent(
      initializer,
      scopes,
      didReadCollectionValue,
      visitedSymbolIds,
    );
  }
  if (isNodeOfType(expression, "MemberExpression")) {
    if (getStaticPropertyName(expression) === "current") {
      const symbol = resolveReactRefSymbol(expression, scopes, {
        allowUnboundBareCalls: true,
        includeCreateRef: true,
        resolveNamedAliases: true,
      });
      return Boolean(
        symbol &&
        (isDirectHostJsxRef(symbol, scopes) ||
          (didReadCollectionValue && storesOnlyIntrinsicRefCallbackValues(symbol, scopes))),
      );
    }
    return isDerivedFromProvenDomRefCurrent(
      expression.object,
      scopes,
      didReadCollectionValue,
      visitedSymbolIds,
    );
  }
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  return isDerivedFromProvenDomRefCurrent(
    callee.object,
    scopes,
    didReadCollectionValue || getStaticPropertyName(callee) === "get",
    visitedSymbolIds,
  );
};

const isCommittedDomSyncNode = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(callee);
  if (propertyName === null || !EXTERNAL_SYNC_DOM_MEMBER_METHOD_NAMES.has(propertyName)) {
    return false;
  }
  return (
    isDerivedFromProvenDomRefCurrent(callee.object, scopes) ||
    isProvenBrowserApiReceiver(callee.object, "dom-event-target", scopes)
  );
};

const isProvenHttpClientReceiver = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Identifier")) {
    const receiverSymbol = scopes.symbolFor(expression);
    if (receiverSymbol && !hasSafeReceiverAliases(new Set([receiverSymbol]), scopes)) return false;
  }
  if (
    hasProvenGlobalNamespaceReference(expression, EXTERNAL_SYNC_GLOBAL_HTTP_CLIENT_NAMES, scopes)
  ) {
    return true;
  }
  const moduleBinding = resolveExternalModuleBinding(expression, scopes);
  if (
    moduleBinding &&
    EXTERNAL_SYNC_HTTP_CLIENT_MODULE_SOURCES.has(moduleBinding.source) &&
    (moduleBinding.isModuleObject ||
      (moduleBinding.exportedName === "default" &&
        EXTERNAL_SYNC_DEFAULT_IMPORT_NAMES.has(moduleBinding.source)) ||
      isKnownExternalSyncDirectModuleBinding(moduleBinding))
  ) {
    return true;
  }
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = stripParenExpression(expression.callee);
    return Boolean(
      isNodeOfType(callee, "MemberExpression") &&
      getStaticPropertyName(callee) === "create" &&
      isProvenHttpClientReceiver(callee.object, scopes, visitedSymbolIds),
    );
  }
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.symbolFor(expression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  if (resolveExternalModuleBinding(expression, scopes, new Set(), true)) return false;
  const initializer = getDirectUnreassignedInitializer(symbol);
  return Boolean(
    initializer &&
    isProvenHttpClientReceiver(initializer, scopes, new Set(visitedSymbolIds).add(symbol.id)),
  );
};

const isProvenTanStackQueryClientReceiver = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Identifier")) {
    const receiverSymbol = scopes.symbolFor(expression);
    if (receiverSymbol && !hasSafeReceiverAliases(new Set([receiverSymbol]), scopes)) return false;
  }
  if (isNodeOfType(expression, "CallExpression")) {
    const binding = resolveExternalModuleBinding(expression.callee, scopes);
    return Boolean(
      binding &&
      binding.source === "@tanstack/react-query" &&
      binding.exportedName === "useQueryClient",
    );
  }
  if (isNodeOfType(expression, "NewExpression")) {
    const binding = resolveExternalModuleBinding(expression.callee, scopes);
    return Boolean(
      binding &&
      TANSTACK_QUERY_CLIENT_MODULE_SOURCES.has(binding.source) &&
      binding.exportedName === "QueryClient",
    );
  }
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.symbolFor(expression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  const initializer = getDirectUnreassignedInitializer(symbol);
  return Boolean(
    initializer &&
    isProvenTanStackQueryClientReceiver(
      initializer,
      scopes,
      new Set(visitedSymbolIds).add(symbol.id),
    ),
  );
};

const isProvenExternalResourceReceiver = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: ReadonlySet<number> = new Set(),
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (
    isDerivedFromProvenDomRefCurrent(expression, scopes) ||
    isProvenBrowserApiReceiver(expression, "dom-event-target", scopes) ||
    isProvenBrowserApiReceiver(expression, "xml-http-request", scopes) ||
    isProvenHttpClientReceiver(expression, scopes)
  ) {
    return true;
  }
  if (isNodeOfType(expression, "NewExpression")) {
    return hasProvenGlobalNamespaceReference(
      expression.callee,
      EXTERNAL_SYNC_RESOURCE_CONSTRUCTOR_NAMES,
      scopes,
    );
  }
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.symbolFor(expression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  const initializer = getDirectUnreassignedInitializer(symbol);
  return Boolean(
    initializer &&
    isProvenExternalResourceReceiver(initializer, scopes, new Set(visitedSymbolIds).add(symbol.id)),
  );
};

const isProvenExternalSyncDirectCallee = (callee: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (hasProvenGlobalNamespaceReference(callee, EXTERNAL_SYNC_DIRECT_CALLEE_NAMES, scopes)) {
    return true;
  }
  const moduleBinding = resolveExternalModuleBinding(callee, scopes);
  return Boolean(moduleBinding && isKnownExternalSyncDirectModuleBinding(moduleBinding));
};

const isExternalSyncNode = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(node, "NewExpression")) {
    return hasProvenGlobalNamespaceReference(
      node.callee,
      EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS,
      scopes,
    );
  }

  if (isNodeOfType(node, "AssignmentExpression") || isNodeOfType(node, "UpdateExpression")) {
    const mutationTarget = isNodeOfType(node, "AssignmentExpression") ? node.left : node.argument;
    return (
      isNodeOfType(mutationTarget, "MemberExpression") &&
      getStaticPropertyName(mutationTarget) === "current" &&
      Boolean(
        resolveReactRefSymbol(mutationTarget, scopes, {
          allowUnboundBareCalls: true,
          includeCreateRef: true,
          resolveNamedAliases: true,
        }),
      )
    );
  }

  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isProvenExternalSyncDirectCallee(node.callee, scopes)) return true;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;

  const propertyName = getStaticPropertyName(node.callee);
  if (propertyName === null) return false;
  if (isBrowserStorageReceiver(node.callee.object, scopes)) return true;
  if (TANSTACK_QUERY_EXTERNAL_SYNC_METHOD_NAMES.has(propertyName)) {
    return isProvenTanStackQueryClientReceiver(node.callee.object, scopes);
  }
  if (EXTERNAL_SYNC_HTTP_METHOD_NAMES.has(propertyName)) {
    return isProvenHttpClientReceiver(node.callee.object, scopes);
  }
  return (
    EXTERNAL_SYNC_MEMBER_METHOD_NAMES.has(propertyName) &&
    isProvenExternalResourceReceiver(node.callee.object, scopes)
  );
};

const isExternalSyncEffect = (
  effectCallback: EsTreeNode,
  analysisFunctions: ReadonlySet<EsTreeNode>,
  setterToStateName: ReadonlyMap<string, string>,
  setterSymbolIdToStateName: ReadonlyMap<number, string>,
  scopes: ScopeAnalysis,
  allowCommittedDomSync: boolean,
): boolean => {
  if (!isFunctionLike(effectCallback)) return false;
  // A cleanup return is the strongest signal that the effect owns
  // an external resource — once we see one, we don't need to inspect
  // the body for an external-sync call shape.
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
    if (
      isFunctionShapedReturn(
        effectCallback.body,
        setterToStateName,
        setterSymbolIdToStateName,
        scopes,
        false,
      )
    ) {
      return true;
    }
  } else {
    for (const statement of effectCallback.body.body ?? []) {
      if (
        isNodeOfType(statement, "ReturnStatement") &&
        statement.argument &&
        isFunctionShapedReturn(
          statement.argument,
          setterToStateName,
          setterSymbolIdToStateName,
          scopes,
          true,
        )
      ) {
        return true;
      }
    }
  }

  let didFindExternalCall = false;
  visitSynchronousFunctionBodies(analysisFunctions, (child) => {
    if (
      isExternalSyncNode(child, scopes) ||
      (allowCommittedDomSync && isCommittedDomSyncNode(child, scopes))
    ) {
      didFindExternalCall = true;
    }
  });

  return didFindExternalCall;
};

interface EffectInfo {
  node: EsTreeNode;
  callback: EsTreeNode;
  dependencyStateSymbolIds: Set<number>;
  stateWrites: Map<string, EffectStateWriteInfo>;
  analysisFunctions: ReadonlySet<EsTreeNode>;
  isExternalSync: boolean;
}

export const noEffectChain = defineRule({
  id: "no-effect-chain",
  title: "Effects chained together",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Compute as much as possible during render (e.g. `const isGameOver = round > 5`) and write all related state inside the event handler that originally fires the chain. Each effect link adds an extra render and makes the code rigid as requirements evolve",
  create: (context: RuleContext) => {
    const checkComponent = (componentBody: EsTreeNode | null | undefined): void => {
      if (!componentBody || !isNodeOfType(componentBody, "BlockStatement")) return;

      const useStateBindings = collectUseStateBindings(componentBody, context.scopes);
      if (useStateBindings.length === 0) return;
      const setterToStateName = new Map<string, string>();
      const stateSymbolIds = new Map<string, number>();
      const setterSymbolIdToStateName = new Map<number, string>();
      for (const binding of useStateBindings) {
        setterToStateName.set(binding.setterName, binding.valueName);
        if (!isNodeOfType(binding.declarator.id, "ArrayPattern")) continue;
        const stateIdentifier = binding.declarator.id.elements[0];
        const setterIdentifier = binding.declarator.id.elements[1];
        if (isNodeOfType(stateIdentifier, "Identifier")) {
          const stateSymbol = context.scopes.symbolFor(stateIdentifier);
          if (stateSymbol) stateSymbolIds.set(binding.valueName, stateSymbol.id);
        }
        if (isNodeOfType(setterIdentifier, "Identifier")) {
          const setterSymbol = context.scopes.symbolFor(setterIdentifier);
          if (setterSymbol) setterSymbolIdToStateName.set(setterSymbol.id, binding.valueName);
        }
      }

      const storageSetterNames = collectStorageHookSetterNames(componentBody);
      const stateSymbolIdSet = new Set(stateSymbolIds.values());

      const effectInfos: EffectInfo[] = [];
      for (const effectCall of findTopLevelEffectCalls(componentBody, context.scopes)) {
        const callback = getEffectCallback(effectCall, context.scopes);
        if (!callback || !isFunctionLike(callback) || callback.async) continue;
        const analysisFunctions = collectSynchronouslyInvokedFunctions(callback, context.scopes);
        const stateWriteAnalysisFunctions = collectStateWriteAnalysisFunctions(
          callback,
          context.scopes,
          setterSymbolIdToStateName,
        );
        const stateWrites = collectStateWritesInEffect(
          stateWriteAnalysisFunctions,
          setterSymbolIdToStateName,
          context.scopes,
        );
        const writtenStateNames = new Set(stateWrites.keys());
        effectInfos.push({
          node: effectCall,
          callback,
          dependencyStateSymbolIds: collectDependencyStateSymbolIds(
            effectCall,
            stateSymbolIdSet,
            context.scopes,
          ),
          stateWrites,
          analysisFunctions,
          isExternalSync:
            isExternalSyncEffect(
              callback,
              analysisFunctions,
              setterToStateName,
              setterSymbolIdToStateName,
              context.scopes,
              writtenStateNames.size === 0,
            ) ||
            callsStorageHookSetter(analysisFunctions, storageSetterNames) ||
            (writtenStateNames.size === 0 &&
              callsOpaqueExternalSetter(analysisFunctions, setterToStateName)),
        });
      }
      if (effectInfos.length < 2) return;

      const reportedNodes = new Set<EsTreeNode>();
      for (const writerEffect of effectInfos) {
        if (writerEffect.isExternalSync) continue;
        if (writerEffect.stateWrites.size === 0) continue;
        for (const readerEffect of effectInfos) {
          if (readerEffect === writerEffect) continue;
          if (readerEffect.isExternalSync) continue;
          if (readerEffect.dependencyStateSymbolIds.size === 0) continue;

          let chainedStateName: string | null = null;
          for (const writtenName of writerEffect.stateWrites.keys()) {
            const writtenStateSymbolId = stateSymbolIds.get(writtenName);
            if (
              writtenStateSymbolId === undefined ||
              !readerEffect.dependencyStateSymbolIds.has(writtenStateSymbolId)
            ) {
              continue;
            }
            if (
              !canStateWriteReachReaderWork(
                writtenName,
                writerEffect,
                readerEffect,
                stateSymbolIds,
                context.scopes,
              )
            ) {
              continue;
            }
            chainedStateName = writtenName;
            break;
          }
          if (!chainedStateName) continue;
          if (reportedNodes.has(readerEffect.node)) continue;
          reportedNodes.add(readerEffect.node);

          context.report({
            node: readerEffect.node,
            message: `Your screen redraws several times from a single action because one useEffect changes "${chainedStateName}", which sets off this one.`,
          });
        }
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        checkComponent(node.body);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        checkComponent(node.init.body);
      },
    };
  },
});
