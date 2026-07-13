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

// HACK: only count setter calls that actually run during the effect's
// synchronous body. A `setX` inside `setTimeout(() => setX(...))` or
// `.then(() => setX(...))` is a DEFERRED write — by the time it fires,
// the chain reader effect has already had its dep-update window. Treat
// only direct (non-nested-function) writes as chain triggers; that
// stops `noEffectChain` from over-flagging the dominant debounce /
// async-fetch shape that real codebases use.
const collectWrittenStateNamesInEffect = (
  analysisFunctions: ReadonlySet<EsTreeNode>,
  setterToStateName: Map<string, string>,
): Set<string> => {
  const writtenStateNames = new Set<string>();
  visitSynchronousFunctionBodies(analysisFunctions, (child) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    const stateName = setterToStateName.get(child.callee.name);
    if (stateName) writtenStateNames.add(stateName);
  });
  return writtenStateNames;
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
  writtenStateNames: Set<string>;
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
      for (const binding of useStateBindings) {
        setterToStateName.set(binding.setterName, binding.valueName);
      }

      const storageSetterNames = collectStorageHookSetterNames(componentBody);

      const effectInfos: EffectInfo[] = [];
      for (const effectCall of findTopLevelEffectCalls(componentBody)) {
        const callback = getEffectCallback(effectCall, context.scopes);
        if (!callback) continue;
        const analysisFunctions = collectSynchronouslyInvokedFunctions(callback, context.scopes);
        const writtenStateNames = collectWrittenStateNamesInEffect(
          analysisFunctions,
          setterToStateName,
        );
        effectInfos.push({
          node: effectCall,
          depNames: collectDepIdentifierNames(effectCall),
          writtenStateNames,
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
        if (writerEffect.writtenStateNames.size === 0) continue;
        for (const readerEffect of effectInfos) {
          if (readerEffect === writerEffect) continue;
          if (readerEffect.isExternalSync) continue;
          if (readerEffect.depNames.size === 0) continue;

          let chainedStateName: string | null = null;
          for (const writtenName of writerEffect.writtenStateNames) {
            if (readerEffect.depNames.has(writtenName)) {
              chainedStateName = writtenName;
              break;
            }
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
