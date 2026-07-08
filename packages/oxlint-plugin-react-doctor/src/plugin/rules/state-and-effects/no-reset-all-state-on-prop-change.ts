import type { Reference } from "eslint-scope";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getCallExpr, getDownstreamRefs, getRef, getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis, type ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  findContainingNode,
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  getUseStateDecl,
  isCustomHook,
  isProp,
  isState,
  isSyncStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";

// 1:1 port of upstream `src/rules/no-reset-all-state-on-prop-change.js`.

const isUndefinedNode = (node: EsTreeNode | null | undefined): boolean => {
  if (node === null || node === undefined) return true;
  return isNodeOfType(node, "Identifier") && node.name === "undefined";
};

const getNodeText = (node: EsTreeNode | null | undefined): string => {
  if (!node) return "";
  return JSON.stringify(node, (key, value) => {
    if (key === "parent" || key === "loc" || key === "range" || key === "start" || key === "end") {
      return undefined;
    }
    return value;
  });
};

const isLiteralConstantIdentifier = (
  analysis: ProgramAnalysis,
  identifier: EsTreeNode,
): boolean => {
  const reference = getRef(analysis, identifier);
  const definitions = reference?.resolved?.defs;
  if (!definitions || definitions.length !== 1) return false;
  const definition = definitions[0];
  if (definition.type !== "Variable") return false;
  const declarator = definition.node as unknown as EsTreeNode;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return false;
  const declaration = declarator.parent;
  if (!isNodeOfType(declaration, "VariableDeclaration") || declaration.kind !== "const") {
    return false;
  }
  return isNodeOfType(declarator.init, "Literal");
};

const isSetStateToInitialValue = (analysis: ProgramAnalysis, setterRef: Reference): boolean => {
  const callExpr = getCallExpr(setterRef);
  if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) return false;
  const setStateToValue: EsTreeNode | undefined = callExpr.arguments?.[0] as EsTreeNode | undefined;
  const useStateDecl = getUseStateDecl(analysis, setterRef);
  if (!useStateDecl || !isNodeOfType(useStateDecl, "VariableDeclarator")) return false;
  if (!isNodeOfType(useStateDecl.init, "CallExpression")) return false;
  const stateInitialValue = useStateDecl.init.arguments?.[0] as EsTreeNode | undefined;

  if (isUndefinedNode(setStateToValue) && isUndefinedNode(stateInitialValue)) return true;
  if (setStateToValue == null && stateInitialValue == null) return true;
  if ((setStateToValue && !stateInitialValue) || (!setStateToValue && stateInitialValue)) {
    return false;
  }
  // `useState(value)` seeded from a LIVE binding: `setX(value)` later
  // re-syncs to the binding's CURRENT value, not the mount-time initial —
  // a draft re-sync, not a reset (ant-design-mobile picker, delta audit).
  // A `const x = <literal>` named constant is NOT live: resetting to it is
  // resetting to the initial value (upstream parity "shared var" case).
  if (
    stateInitialValue &&
    isNodeOfType(stateInitialValue, "Identifier") &&
    stateInitialValue.name !== "undefined" &&
    !isLiteralConstantIdentifier(analysis, stateInitialValue)
  ) {
    return false;
  }
  return getNodeText(setStateToValue) === getNodeText(stateInitialValue);
};

const countUseStates = (analysis: ProgramAnalysis, componentNode: EsTreeNode | null): number => {
  if (!componentNode) return 0;
  const stateVariables = new Set<Reference["resolved"]>();
  for (const ref of getDownstreamRefs(analysis, componentNode)) {
    if (isState(analysis, ref)) stateVariables.add(ref.resolved);
  }
  return stateVariables.size;
};

const findPropUsedToResetAllState = (
  analysis: ProgramAnalysis,
  effectFnRefs: Reference[],
  depsRefs: Reference[],
  useEffectNode: EsTreeNode,
  effectFn: EsTreeNode,
): Reference | null => {
  // A setter that only runs inside a listener / observer / subscription
  // callback fires on that event, not when the prop changes — only
  // synchronous setter calls are the reset-on-prop-change shape.
  const stateSetterRefs = effectFnRefs.filter((ref) =>
    isSyncStateSetterCall(analysis, ref, effectFn),
  );
  if (stateSetterRefs.length === 0) return null;

  const allResetToInitial = stateSetterRefs.every((ref) => isSetStateToInitialValue(analysis, ref));
  if (!allResetToInitial) return null;

  // The sync reset is the loading phase of a fetch lifecycle when the SAME
  // state is set again from an async continuation inside this effect (the
  // real value arrives later; cleanup cancels stale requests) — freecut
  // inline-source-preview / inline-composition-preview in the delta audit.
  const isEveryResetReloadedAsync = stateSetterRefs.every((setterRef) =>
    effectFnRefs.some(
      (otherRef) =>
        otherRef !== setterRef &&
        otherRef.resolved === setterRef.resolved &&
        Boolean(getCallExpr(otherRef)) &&
        !isSyncStateSetterCall(analysis, otherRef, effectFn),
    ),
  );
  if (isEveryResetReloadedAsync) return null;

  const containing = findContainingNode(analysis, useEffectNode);
  // Distinct state VARIABLES reset — two call sites of one setter must not
  // satisfy a two-useState component (freecut inline-composition-preview,
  // delta audit).
  const resetStateVariables = new Set(stateSetterRefs.map((setterRef) => setterRef.resolved));
  if (resetStateVariables.size !== countUseStates(analysis, containing)) return null;

  for (const depRef of depsRefs) {
    for (const upRef of getUpstreamRefs(analysis, depRef)) {
      if (isProp(analysis, upRef)) return upRef;
    }
  }
  return null;
};

export const noResetAllStateOnPropChange = defineRule({
  id: "no-reset-all-state-on-prop-change",
  title: "All state reset on prop change",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Pass the prop as `key` so React resets the component for you when the prop changes, instead of clearing every state value by hand in a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseEffect(node)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const containing = findContainingNode(analysis, node);
      if (containing && isCustomHook(containing)) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      const propUsedToReset = findPropUsedToResetAllState(
        analysis,
        effectFnRefs,
        depsRefs,
        node,
        effectFn,
      );
      if (!propUsedToReset) return;
      context.report({
        node,
        message: `Your users briefly see stale state when a prop changes because this useEffect clears all state.`,
      });
    },
  }),
});
