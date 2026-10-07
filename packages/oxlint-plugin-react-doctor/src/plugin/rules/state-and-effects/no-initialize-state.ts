import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import {
  collectEffectStateWriteFacts,
  type EffectStateWriteFact,
} from "./utils/collect-effect-state-write-facts.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { stateControlsRenderedOutput } from "./utils/state-controls-rendered-output.js";

const getStateName = (stateDeclarator: EsTreeNode): string => {
  if (!isNodeOfType(stateDeclarator, "VariableDeclarator")) return "<state>";
  if (!isNodeOfType(stateDeclarator.id, "ArrayPattern")) return "<state>";
  const stateBinding = stateDeclarator.id.elements?.[0] ?? stateDeclarator.id.elements?.[1];
  return stateBinding && isNodeOfType(stateBinding, "Identifier") ? stateBinding.name : "<state>";
};

const isRenderControllingMountSentinel = (
  fact: EffectStateWriteFact,
  effectNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    fact.isDeferred ||
    fact.hasIndependentWriter ||
    fact.matchesStateInitializer ||
    fact.resetsSourceState ||
    !isNodeOfType(fact.stateDeclarator, "VariableDeclarator") ||
    !isNodeOfType(fact.stateDeclarator.id, "ArrayPattern") ||
    !isNodeOfType(fact.stateDeclarator.init, "CallExpression")
  ) {
    return false;
  }
  const setterCall = fact.callExpression;
  if (!isNodeOfType(setterCall, "CallExpression")) return false;
  const stateIdentifier = fact.stateDeclarator.id.elements[0];
  const initialState = fact.stateDeclarator.init.arguments[0];
  const writtenValue = setterCall.arguments[0];
  if (
    !stateIdentifier ||
    !isNodeOfType(stateIdentifier, "Identifier") ||
    !initialState ||
    isNodeOfType(initialState, "SpreadElement") ||
    !writtenValue ||
    isNodeOfType(writtenValue, "SpreadElement")
  ) {
    return false;
  }
  const initialValue = readStaticBoolean(initialState);
  const nextValue = readStaticBoolean(writtenValue);
  if (initialValue === null || nextValue === null || initialValue === nextValue) return false;
  const effectCallback = getEffectCallback(effectNode, context.scopes);
  if (!effectCallback || findEnclosingFunction(setterCall) !== effectCallback) return false;
  const setterCallee = setterCall.callee;
  const setterSymbol = isNodeOfType(setterCallee, "Identifier")
    ? context.scopes.symbolFor(setterCallee)
    : null;
  if (!setterSymbol) return false;
  let hasAdditionalStateWrite = false;
  walkAst(effectCallback, (child) => {
    if (hasAdditionalStateWrite) return false;
    if (
      child !== setterCall &&
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      context.scopes.symbolFor(child.callee)?.id === setterSymbol.id
    ) {
      hasAdditionalStateWrite = true;
      return false;
    }
  });
  if (hasAdditionalStateWrite) return false;
  const stateSymbol = context.scopes.symbolFor(stateIdentifier);
  const renderFunction = findEnclosingFunction(fact.stateDeclarator);
  return Boolean(
    stateSymbol &&
    renderFunction &&
    stateControlsRenderedOutput(stateSymbol, renderFunction, context.scopes),
  );
};

export const noInitializeState = defineRule({
  id: "no-initialize-state",
  title: "State initialized from a mount effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Pass the initial value directly to useState() instead of setting it from a mount-only useEffect. For SSR hydration, prefer useSyncExternalStore().",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, "useEffect", context.scopes)) return;
      const dependencies = node.arguments?.[1];
      if (
        !dependencies ||
        !isNodeOfType(dependencies, "ArrayExpression") ||
        (dependencies.elements ?? []).length !== 0
      ) {
        return;
      }
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      for (const fact of collectEffectStateWriteFacts(analysis, context, node, context.filename)) {
        const isRenderKnownInitialization =
          fact.isRenderKnownCopy && !fact.matchesStateInitializer && !fact.resetsSourceState;
        if (
          !isRenderKnownInitialization &&
          !isRenderControllingMountSentinel(fact, node, context)
        ) {
          continue;
        }
        const stateName = getStateName(fact.stateDeclarator);
        context.report({
          node: fact.callExpression,
          message: `Your users see an extra render with empty "${stateName}" because a useEffect sets its starting value.`,
        });
      }
    },
  }),
});
