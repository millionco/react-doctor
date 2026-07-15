import { EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS } from "../../constants/dom.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import {
  EFFECT_HOOK_NAMES,
  EXTERNAL_SYNC_AMBIGUOUS_HTTP_METHOD_NAMES,
  EXTERNAL_SYNC_DIRECT_CALLEE_NAMES,
  EXTERNAL_SYNC_HTTP_CLIENT_RECEIVERS,
  EXTERNAL_SYNC_MEMBER_METHOD_NAMES,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { unwrapDiscardedExpression } from "../../utils/unwrap-discarded-expression.js";
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
//        - depNames: Identifier names in the dep array
//        - writtenStateNames: state names whose setter is called in the body
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
const findTopLevelEffectCalls = (componentBody: EsTreeNode): EsTreeNode[] => {
  const effectCalls: EsTreeNode[] = [];
  if (!isNodeOfType(componentBody, "BlockStatement")) return effectCalls;
  for (const statement of componentBody.body ?? []) {
    if (!isNodeOfType(statement, "ExpressionStatement")) continue;
    const expression = unwrapDiscardedExpression(statement);
    if (!isNodeOfType(expression, "CallExpression")) continue;
    if (!isHookCall(expression, EFFECT_HOOK_NAMES)) continue;
    effectCalls.push(expression);
  }
  return effectCalls;
};

const collectDepIdentifierNames = (effectNode: EsTreeNode): Set<string> => {
  const depNames = new Set<string>();
  if (!isNodeOfType(effectNode, "CallExpression")) return depNames;
  const depsNode = effectNode.arguments?.[1];
  if (!isNodeOfType(depsNode, "ArrayExpression")) return depNames;
  for (const element of depsNode.elements ?? []) {
    if (isNodeOfType(element, "Identifier")) depNames.add(element.name);
  }
  return depNames;
};

const collectSynchronouslyInvokedFunctions = (
  effectCallback: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlySet<EsTreeNode> => {
  const analysisFunctions = new Set<EsTreeNode>([effectCallback]);
  const pendingFunctions = [effectCallback];
  while (pendingFunctions.length > 0) {
    const currentFunction = pendingFunctions.pop();
    if (!currentFunction || !isFunctionLike(currentFunction)) continue;
    walkInsideStatementBlocks(currentFunction.body, (child) => {
      if (!isNodeOfType(child, "CallExpression")) return;
      const invokedFunction = resolveExactLocalFunction(child.callee, scopes);
      if (!invokedFunction || analysisFunctions.has(invokedFunction)) return;
      if (isFunctionLike(invokedFunction) && invokedFunction.async) return;
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
    if (unwrappedExpression.name === "undefined" && scopes.isGlobalReference(unwrappedExpression)) {
      return { value: undefined };
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
    );
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    const testValue = readStaticEffectValue(
      unwrappedExpression.test,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
    );
    if (!testValue) return null;
    return readStaticEffectValue(
      testValue.value ? unwrappedExpression.consequent : unwrappedExpression.alternate,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
    );
  }
  if (isNodeOfType(unwrappedExpression, "MemberExpression") && unwrappedExpression.optional) {
    const objectValue = readStaticEffectValue(
      unwrappedExpression.object,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
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
    );
    const rightValue = readStaticEffectValue(
      unwrappedExpression.right,
      scopes,
      stateSymbolId,
      stateValue,
      visitedSymbolIds,
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
  setterToStateName: Map<string, string>,
  scopes: ScopeAnalysis,
): Map<string, EffectStateWriteInfo> => {
  const stateWrites = new Map<string, EffectStateWriteInfo>();
  visitSynchronousFunctionBodies(analysisFunctions, (child) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    const stateName = setterToStateName.get(child.callee.name);
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
): boolean => {
  let currentNode = workNode;
  while (currentNode.parent) {
    const parentNode: EsTreeNode = currentNode.parent;
    if (isFunctionLike(parentNode)) break;
    if (isNodeOfType(parentNode, "IfStatement")) {
      const testValue = readStaticEffectValue(parentNode.test, scopes, stateSymbolId, stateValue);
      if (testValue) {
        if (currentNode === parentNode.consequent && !testValue.value) return false;
        if (currentNode === parentNode.alternate && testValue.value) return false;
      }
    }
    if (isNodeOfType(parentNode, "ConditionalExpression")) {
      const testValue = readStaticEffectValue(parentNode.test, scopes, stateSymbolId, stateValue);
      if (testValue) {
        if (currentNode === parentNode.consequent && !testValue.value) return false;
        if (currentNode === parentNode.alternate && testValue.value) return false;
      }
    }
    if (isNodeOfType(parentNode, "LogicalExpression") && currentNode === parentNode.right) {
      const leftValue = readStaticEffectValue(parentNode.left, scopes, stateSymbolId, stateValue);
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
    const invokedFunction = resolveExactLocalFunction(node.callee, scopes);
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

const canStateWriteReachReaderWork = (
  writeInfo: EffectStateWriteInfo,
  readerEffect: EffectInfo,
  stateSymbolId: number | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (writeInfo.hasUnknownValue || stateSymbolId === null) return true;
  for (const writtenValue of writeInfo.values) {
    const stateValue = { value: writtenValue };
    let didFindReachableWork = false;
    visitSynchronousFunctionBodies(readerEffect.analysisFunctions, (child) => {
      if (
        didFindReachableWork ||
        !isReaderWorkNode(child, readerEffect.analysisFunctions, scopes)
      ) {
        return;
      }
      if (isWorkNodeReachableForStateValue(child, stateSymbolId, stateValue, scopes)) {
        didFindReachableWork = true;
      }
    });
    if (didFindReachableWork) return true;
  }
  return false;
};

const EMPTY_CLEANUP_NAME_SET = new Set<string>();

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
  isExplicitReturnStatement: boolean,
): boolean => {
  if (
    isNodeOfType(returnedValue, "ArrowFunctionExpression") ||
    isNodeOfType(returnedValue, "FunctionExpression")
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
  if (isNodeOfType(returnedValue, "CallExpression")) {
    if (isNodeOfType(returnedValue.callee, "Identifier")) {
      if (setterToStateName.has(returnedValue.callee.name)) return false;
      if (isSetterIdentifier(returnedValue.callee.name)) return true;
    }
    return isCleanupReturn(returnedValue, EMPTY_CLEANUP_NAME_SET, EMPTY_CLEANUP_NAME_SET, {
      allowOpaqueReturn: isExplicitReturnStatement,
    });
  }
  // Returning a bare Identifier — could be the unsub binding from a
  // `const unsub = subscribe(...)` line. We can't statically prove
  // it's function-typed without scope analysis, but in idiomatic React
  // this is the dominant cleanup pattern. Accept.
  if (isNodeOfType(returnedValue, "Identifier")) return true;
  return false;
};

// `localStorage.setItem(...)` / `sessionStorage.getItem(...)` — browser
// storage IS an external system (react.dev's own external-sync example),
// but the member-method constants missed it (docs-validation r2
// docMismatch: Security.jsx device-preference persistence). Covers the
// bare global and the `window.localStorage` spelling.
const STORAGE_GLOBAL_NAMES = new Set(["localStorage", "sessionStorage"]);

const isBrowserStorageReceiver = (receiver: EsTreeNode | null | undefined): boolean => {
  if (!receiver) return false;
  if (isNodeOfType(receiver, "Identifier")) return STORAGE_GLOBAL_NAMES.has(receiver.name);
  if (isNodeOfType(receiver, "MemberExpression")) {
    return (
      isNodeOfType(receiver.property, "Identifier") &&
      STORAGE_GLOBAL_NAMES.has(receiver.property.name)
    );
  }
  return false;
};

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

const isExternalSyncNode = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "NewExpression")) {
    return (
      isNodeOfType(node.callee, "Identifier") &&
      EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(node.callee.name)
    );
  }

  if (isNodeOfType(node, "AssignmentExpression")) {
    return (
      isNodeOfType(node.left, "MemberExpression") &&
      isNodeOfType(node.left.property, "Identifier") &&
      node.left.property.name === "current"
    );
  }

  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isNodeOfType(node.callee, "Identifier")) {
    return EXTERNAL_SYNC_DIRECT_CALLEE_NAMES.has(node.callee.name);
  }
  if (
    !isNodeOfType(node.callee, "MemberExpression") ||
    !isNodeOfType(node.callee.property, "Identifier")
  ) {
    return false;
  }

  const propertyName = node.callee.property.name;
  if (EXTERNAL_SYNC_MEMBER_METHOD_NAMES.has(propertyName)) return true;
  if (isBrowserStorageReceiver(node.callee.object)) return true;
  if (!EXTERNAL_SYNC_AMBIGUOUS_HTTP_METHOD_NAMES.has(propertyName)) return false;
  const receiverRootName = getRootIdentifierName(node.callee.object);
  return receiverRootName !== null && EXTERNAL_SYNC_HTTP_CLIENT_RECEIVERS.has(receiverRootName);
};

const isExternalSyncEffect = (
  effectCallback: EsTreeNode,
  analysisFunctions: ReadonlySet<EsTreeNode>,
  setterToStateName: ReadonlyMap<string, string>,
): boolean => {
  if (!isFunctionLike(effectCallback)) return false;
  // A cleanup return is the strongest signal that the effect owns
  // an external resource — once we see one, we don't need to inspect
  // the body for an external-sync call shape.
  if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
    if (isFunctionShapedReturn(effectCallback.body, setterToStateName, false)) return true;
  } else {
    for (const statement of effectCallback.body.body ?? []) {
      if (
        isNodeOfType(statement, "ReturnStatement") &&
        statement.argument &&
        isFunctionShapedReturn(statement.argument, setterToStateName, true)
      ) {
        return true;
      }
    }
  }

  let didFindExternalCall = false;
  visitSynchronousFunctionBodies(analysisFunctions, (child) => {
    if (isExternalSyncNode(child)) didFindExternalCall = true;
  });

  return didFindExternalCall;
};

interface EffectInfo {
  node: EsTreeNode;
  depNames: Set<string>;
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

      const useStateBindings = collectUseStateBindings(componentBody);
      if (useStateBindings.length === 0) return;
      const setterToStateName = new Map<string, string>();
      const stateSymbolIds = new Map<string, number>();
      for (const binding of useStateBindings) {
        setterToStateName.set(binding.setterName, binding.valueName);
        if (!isNodeOfType(binding.declarator.id, "ArrayPattern")) continue;
        const stateIdentifier = binding.declarator.id.elements[0];
        if (isNodeOfType(stateIdentifier, "Identifier")) {
          const stateSymbol = context.scopes.symbolFor(stateIdentifier);
          if (stateSymbol) stateSymbolIds.set(binding.valueName, stateSymbol.id);
        }
      }

      const storageSetterNames = collectStorageHookSetterNames(componentBody);

      const effectInfos: EffectInfo[] = [];
      for (const effectCall of findTopLevelEffectCalls(componentBody)) {
        const callback = getEffectCallback(effectCall, context.scopes);
        if (!callback || !isFunctionLike(callback) || callback.async) continue;
        const analysisFunctions = collectSynchronouslyInvokedFunctions(callback, context.scopes);
        const stateWrites = collectStateWritesInEffect(
          analysisFunctions,
          setterToStateName,
          context.scopes,
        );
        const writtenStateNames = new Set(stateWrites.keys());
        effectInfos.push({
          node: effectCall,
          depNames: collectDepIdentifierNames(effectCall),
          stateWrites,
          analysisFunctions,
          isExternalSync:
            isExternalSyncEffect(callback, analysisFunctions, setterToStateName) ||
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
          if (readerEffect.depNames.size === 0) continue;

          let chainedStateName: string | null = null;
          for (const [writtenName, writeInfo] of writerEffect.stateWrites) {
            if (!readerEffect.depNames.has(writtenName)) continue;
            if (
              !canStateWriteReachReaderWork(
                writeInfo,
                readerEffect,
                stateSymbolIds.get(writtenName) ?? null,
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
