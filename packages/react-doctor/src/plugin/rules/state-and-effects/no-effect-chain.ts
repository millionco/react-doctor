import { EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS } from "../../constants/dom.js";
import {
  EFFECT_HOOK_NAMES,
  EXTERNAL_SYNC_AMBIGUOUS_HTTP_METHOD_NAMES,
  EXTERNAL_SYNC_DIRECT_CALLEE_NAMES,
  EXTERNAL_SYNC_HTTP_CLIENT_RECEIVERS,
  EXTERNAL_SYNC_MEMBER_METHOD_NAMES,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

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
    const expression = statement.expression;
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

// HACK: only count setter calls that actually run during the effect's
// synchronous body. A `setX` inside `setTimeout(() => setX(...))` or
// `.then(() => setX(...))` is a DEFERRED write — by the time it fires,
// the chain reader effect has already had its dep-update window. Treat
// only direct (non-nested-function) writes as chain triggers; that
// stops `noEffectChain` from over-flagging the dominant debounce /
// async-fetch shape that real codebases use.
const collectWrittenStateNamesInEffect = (
  effectCallback: EsTreeNode,
  setterToStateName: Map<string, string>,
): Set<string> => {
  const writtenStateNames = new Set<string>();
  if (
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
    !isNodeOfType(effectCallback, "FunctionExpression")
  ) {
    return writtenStateNames;
  }
  walkInsideStatementBlocks(effectCallback.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    const stateName = setterToStateName.get(child.callee.name);
    if (stateName) writtenStateNames.add(stateName);
  });
  return writtenStateNames;
};

// HACK: a useEffect cleanup return value MUST be a function (or
// undefined). Anything else is either user error or "I'm using
// `return` for early-exit, not for cleanup". For the chain detector,
// we treat only function-shaped returns as "this effect owns an
// external resource" — bare literals (`return null`, `return 0`) and
// state reads (`return foo`) get ignored so they don't silently
// disable chain detection.
const isFunctionShapedReturn = (returnedValue: EsTreeNode): boolean => {
  if (
    isNodeOfType(returnedValue, "ArrowFunctionExpression") ||
    isNodeOfType(returnedValue, "FunctionExpression")
  ) {
    return true;
  }
  // Returning a CallExpression result — most cleanup-returning
  // primitives (subscribe, addEventListener helpers) return a
  // function. Conservatively accept this shape.
  if (isNodeOfType(returnedValue, "CallExpression")) return true;
  // Returning a bare Identifier — could be the unsub binding from a
  // `const unsub = subscribe(...)` line. We can't statically prove
  // it's function-typed without scope analysis, but in idiomatic React
  // this is the dominant cleanup pattern. Accept.
  if (isNodeOfType(returnedValue, "Identifier")) return true;
  return false;
};

const isExternalSyncEffect = (effectCallback: EsTreeNode): boolean => {
  if (
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
    !isNodeOfType(effectCallback, "FunctionExpression")
  ) {
    return false;
  }
  // A cleanup return is the strongest signal that the effect owns
  // an external resource — once we see one, we don't need to inspect
  // the body for an external-sync call shape.
  if (isNodeOfType(effectCallback.body, "BlockStatement")) {
    const statements = effectCallback.body.body ?? [];
    for (const statement of statements) {
      if (
        isNodeOfType(statement, "ReturnStatement") &&
        statement.argument &&
        isFunctionShapedReturn(statement.argument)
      ) {
        return true;
      }
    }
  }

  let didFindExternalCall = false;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (didFindExternalCall) return false;

    if (isNodeOfType(child, "NewExpression")) {
      const constructor = child.callee;
      if (
        isNodeOfType(constructor, "Identifier") &&
        EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(constructor.name)
      ) {
        didFindExternalCall = true;
      }
      return;
    }

    if (isNodeOfType(child, "AssignmentExpression")) {
      if (
        isNodeOfType(child.left, "MemberExpression") &&
        isNodeOfType(child.left.property, "Identifier") &&
        child.left.property.name === "current"
      ) {
        didFindExternalCall = true;
      }
      return;
    }

    if (!isNodeOfType(child, "CallExpression")) return;

    if (
      isNodeOfType(child.callee, "Identifier") &&
      EXTERNAL_SYNC_DIRECT_CALLEE_NAMES.has(child.callee.name)
    ) {
      didFindExternalCall = true;
      return;
    }

    if (
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier")
    ) {
      const propertyName = child.callee.property.name;
      if (EXTERNAL_SYNC_MEMBER_METHOD_NAMES.has(propertyName)) {
        didFindExternalCall = true;
        return;
      }
      // HACK: `get` / `head` / `options` are HTTP verbs but also names
      // of universal data-structure methods (Map.get, URLSearchParams.get,
      // etc.). Only count them when the receiver looks like an HTTP
      // client.
      if (EXTERNAL_SYNC_AMBIGUOUS_HTTP_METHOD_NAMES.has(propertyName)) {
        const receiverRootName = getRootIdentifierName(child.callee.object);
        if (
          receiverRootName !== null &&
          EXTERNAL_SYNC_HTTP_CLIENT_RECEIVERS.has(receiverRootName)
        ) {
          didFindExternalCall = true;
        }
      }
    }
  });

  return didFindExternalCall;
};

interface EffectInfo {
  node: EsTreeNode;
  depNames: Set<string>;
  writtenStateNames: Set<string>;
  isExternalSync: boolean;
}

export const noEffectChain = defineRule<Rule>({
  id: "no-effect-chain",
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

      const effectInfos: EffectInfo[] = [];
      for (const effectCall of findTopLevelEffectCalls(componentBody)) {
        const callback = getEffectCallback(effectCall);
        if (!callback) continue;
        effectInfos.push({
          node: effectCall,
          depNames: collectDepIdentifierNames(effectCall),
          writtenStateNames: collectWrittenStateNamesInEffect(callback, setterToStateName),
          isExternalSync: isExternalSyncEffect(callback),
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
            message: `useEffect reacts to "${chainedStateName}" which is set by another useEffect — chains of effects add an extra render per link and become rigid as code evolves. Compute what you can during render and write all related state inside the event handler that originally fires the chain`,
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
