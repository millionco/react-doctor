import {
  REACT_COMPILER_EFFECT_HOOK_NAMES,
  REACT_COMPILER_SET_STATE_IN_EFFECT_DESCRIPTION,
  REACT_COMPILER_SET_STATE_IN_EFFECT_REASON,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { resolveStateWriteSite } from "./utils/collect-effect-state-write-facts.js";
import { getRef } from "./utils/effect/ast.js";
import { getProgramAnalysis, type ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  findContainingNode,
  getEffectFn,
  resolveStateSetterReference,
} from "./utils/effect/react.js";
import { getStaticMemberPropertyName } from "./utils/static-member-property-name.js";

const MESSAGE = `${REACT_COMPILER_SET_STATE_IN_EFFECT_REASON}\n\n${REACT_COMPILER_SET_STATE_IN_EFFECT_DESCRIPTION}.`;

const isStateSetterCallee = (analysis: ProgramAnalysis, callee: EsTreeNode): boolean => {
  const expression = stripParenExpression(callee);
  if (!isNodeOfType(expression, "Identifier")) return false;
  const reference = getRef(analysis, expression);
  return Boolean(reference && resolveStateSetterReference(analysis, reference));
};

const containsNode = (root: EsTreeNode, matches: (node: EsTreeNode) => boolean): boolean => {
  let didFindNode = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (didFindNode) return false;
    if (matches(child)) {
      didFindNode = true;
      return false;
    }
  });
  return didFindNode;
};

const readsRefCurrent = (node: EsTreeNode): boolean =>
  containsNode(
    node,
    (child) =>
      isNodeOfType(child, "MemberExpression") && getStaticMemberPropertyName(child) === "current",
  );

const isRefControlled = (node: EsTreeNode, effectFunction: EsTreeNode): boolean => {
  let child = node;
  let ancestor = node.parent;
  while (ancestor && child !== effectFunction) {
    const test =
      isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")
        ? ancestor.test
        : isNodeOfType(ancestor, "LogicalExpression")
          ? ancestor.left
          : null;
    if (test && test !== child && readsRefCurrent(test as EsTreeNode)) return true;
    child = ancestor;
    ancestor = ancestor.parent;
  }
  return false;
};

const collectSynchronousCalls = (effectFunction: EsTreeNode): EsTreeNode[] => {
  const calls: EsTreeNode[] = [];
  walkAst(effectFunction, (child: EsTreeNode): boolean | void => {
    if (child !== effectFunction && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "CallExpression")) calls.push(child);
  });
  return calls;
};

const isCompilerVisibleSetterCall = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  call: EsTreeNode,
): boolean => {
  if (!isNodeOfType(call, "CallExpression")) return false;
  if (isStateSetterCallee(analysis, call.callee)) return true;
  const localFunction = resolveExactLocalFunction(call.callee, context.scopes);
  return Boolean(
    localFunction &&
    containsNode(
      localFunction,
      (child) =>
        isNodeOfType(child, "CallExpression") && isStateSetterCallee(analysis, child.callee),
    ),
  );
};

const findForwardedSetterInEffect = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  effectFunction: EsTreeNode,
): EsTreeNode | null => {
  const calls = collectSynchronousCalls(effectFunction);
  if (calls.some((call) => isCompilerVisibleSetterCall(analysis, context, call))) return null;
  for (const call of calls) {
    const forwardedWrite = resolveStateWriteSite(analysis, context, call);
    if (!forwardedWrite?.isForwardedWrite) continue;
    if (forwardedWrite.value && readsRefCurrent(forwardedWrite.value)) return null;
    if (isRefControlled(call, effectFunction)) continue;
    return forwardedWrite.setter;
  }
  return null;
};

export const forwardedSetStateInEffect = defineRule({
  id: "forwarded-set-state-in-effect",
  title: "setState in effect through a helper",
  severity: "warn",
  defaultEnabled: false,
  recommendation:
    "Derive the value during render, initialize the state directly, or set it from the event that caused the change. This reports a synchronous state update made through a local setter helper wherever React Compiler's `set-state-in-effect` reports the direct call, and React Doctor reports it under `react-hooks-js/set-state-in-effect`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, REACT_COMPILER_EFFECT_HOOK_NAMES, context.scopes)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis || !findContainingNode(analysis, node)) return;
      const effectFunction = getEffectFn(analysis, node);
      if (!effectFunction || !isFunctionLike(effectFunction) || effectFunction.async) return;
      const forwardedSetter = findForwardedSetterInEffect(analysis, context, effectFunction);
      if (!forwardedSetter) return;
      context.report({ node: forwardedSetter, message: MESSAGE });
    },
  }),
});
