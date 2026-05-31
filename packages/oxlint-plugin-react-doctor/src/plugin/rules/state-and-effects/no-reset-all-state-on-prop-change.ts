import type { Reference } from "eslint-scope";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getCallExpr, getDownstreamRefs, getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis, type ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  findContainingNode,
  getEffectDepsRefs,
  getEffectFnRefs,
  getUseStateDecl,
  isCustomHook,
  isProp,
  isState,
  isStateSetterCall,
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
): Reference | null => {
  const stateSetterRefs = effectFnRefs.filter((ref) => isStateSetterCall(analysis, ref));
  if (stateSetterRefs.length === 0) return null;

  const allResetToInitial = stateSetterRefs.every((ref) => isSetStateToInitialValue(analysis, ref));
  if (!allResetToInitial) return null;

  const containing = findContainingNode(analysis, useEffectNode);
  if (stateSetterRefs.length !== countUseStates(analysis, containing)) return null;

  for (const depRef of depsRefs) {
    for (const upRef of getUpstreamRefs(analysis, depRef)) {
      if (isProp(analysis, upRef)) return upRef;
    }
  }
  return null;
};

export const noResetAllStateOnPropChange = defineRule<Rule>({
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

      const propUsedToReset = findPropUsedToResetAllState(analysis, effectFnRefs, depsRefs, node);
      if (!propUsedToReset) return;
      context.report({
        node,
        message: `Your users briefly see stale state when a prop changes because this useEffect clears all state.`,
      });
    },
  }),
});
