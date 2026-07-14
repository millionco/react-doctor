import type { Reference } from "eslint-scope";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { isOutsideAllFunctions } from "../../utils/is-outside-all-functions.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
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
  isRefCurrent,
  isState,
  isSyncStateSetterCall,
  isUseEffect,
} from "./utils/effect/react.js";
import { getStaticMemberPropertyName } from "./utils/static-member-property-name.js";

// 1:1 port of upstream `src/rules/no-reset-all-state-on-prop-change.js`.

interface LivePropExpressionIdentity {
  propSymbolId: number;
  memberPath: string[];
  booleanNormalization: "identity" | "normalized" | "negated";
}

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

const normalizeAsBoolean = (identity: LivePropExpressionIdentity): LivePropExpressionIdentity => ({
  ...identity,
  booleanNormalization:
    identity.booleanNormalization === "identity" ? "normalized" : identity.booleanNormalization,
});

const negateBoolean = (identity: LivePropExpressionIdentity): LivePropExpressionIdentity => ({
  ...identity,
  booleanNormalization: identity.booleanNormalization === "negated" ? "normalized" : "negated",
});

const getLivePropExpressionIdentity = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  node: EsTreeNode,
  visitedSymbolIds: Set<number> = new Set(),
): LivePropExpressionIdentity | null => {
  const expression = stripParenExpression(node);

  if (isNodeOfType(expression, "Identifier")) {
    const reference = getRef(analysis, expression);
    const symbol = context.scopes.symbolFor(expression);
    if (!reference || !symbol) return null;
    if (isProp(analysis, reference)) {
      return {
        propSymbolId: symbol.id,
        memberPath: [],
        booleanNormalization: "identity",
      };
    }
    if (visitedSymbolIds.has(symbol.id) || symbol.kind !== "const") return null;
    visitedSymbolIds.add(symbol.id);
    const initializer = getDirectConstInitializer(symbol);
    if (initializer) {
      return getLivePropExpressionIdentity(analysis, context, initializer, visitedSymbolIds);
    }
    const hasPropSource = getUpstreamRefs(analysis, reference).some((upstreamReference) =>
      isProp(analysis, upstreamReference),
    );
    return hasPropSource
      ? {
          propSymbolId: symbol.id,
          memberPath: [],
          booleanNormalization: "identity",
        }
      : null;
  }

  if (isNodeOfType(expression, "MemberExpression")) {
    const propertyName = getStaticMemberPropertyName(expression);
    if (!propertyName) return null;
    const objectIdentity = getLivePropExpressionIdentity(
      analysis,
      context,
      expression.object as EsTreeNode,
      visitedSymbolIds,
    );
    if (!objectIdentity) return null;
    return {
      ...objectIdentity,
      memberPath: [...objectIdentity.memberPath, propertyName],
    };
  }

  if (
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(expression.callee, "Identifier") &&
    expression.callee.name === "Boolean" &&
    context.scopes.isGlobalReference(expression.callee) &&
    expression.arguments?.length === 1
  ) {
    const argument = expression.arguments[0] as EsTreeNode;
    const argumentIdentity = getLivePropExpressionIdentity(
      analysis,
      context,
      argument,
      visitedSymbolIds,
    );
    return argumentIdentity ? normalizeAsBoolean(argumentIdentity) : null;
  }

  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    const argumentIdentity = getLivePropExpressionIdentity(
      analysis,
      context,
      expression.argument as EsTreeNode,
      visitedSymbolIds,
    );
    return argumentIdentity ? negateBoolean(argumentIdentity) : null;
  }

  return null;
};

const isMountSnapshotInitializer = (context: RuleContext, node: EsTreeNode): boolean => {
  if (
    !isReactApiCall(node, "useMemo", context.scopes, {
      resolveNamedAliases: true,
    }) ||
    !isNodeOfType(node, "CallExpression")
  ) {
    return false;
  }
  const dependencies = node.arguments?.[1];
  return isNodeOfType(dependencies, "ArrayExpression") && dependencies.elements.length === 0;
};

const isMountSnapshotBinding = (
  context: RuleContext,
  identifier: EsTreeNode,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return false;
  if (isMountSnapshotInitializer(context, initializer)) return true;
  const expression = stripParenExpression(initializer);
  return (
    isNodeOfType(expression, "Identifier") &&
    isMountSnapshotBinding(context, expression, visitedSymbolIds)
  );
};

const isConstantBooleanExpression = (
  context: RuleContext,
  node: EsTreeNode,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) return true;
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = context.scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    const initializer = getDirectConstInitializer(symbol);
    return Boolean(
      initializer && isConstantBooleanExpression(context, initializer, visitedSymbolIds),
    );
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    return isConstantBooleanExpression(
      context,
      expression.argument as EsTreeNode,
      visitedSymbolIds,
    );
  }
  if (
    isNodeOfType(expression, "CallExpression") &&
    isNodeOfType(expression.callee, "Identifier") &&
    expression.callee.name === "Boolean" &&
    context.scopes.isGlobalReference(expression.callee) &&
    expression.arguments?.length === 1
  ) {
    return isConstantBooleanExpression(
      context,
      expression.arguments[0] as EsTreeNode,
      visitedSymbolIds,
    );
  }
  return false;
};

const isProvenLiveBinding = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  identifier: EsTreeNode,
): boolean => {
  const reference = getRef(analysis, identifier);
  const symbol = context.scopes.symbolFor(identifier);
  if (!reference || !symbol || symbol.kind !== "const" || isOutsideAllFunctions(symbol)) {
    return false;
  }
  const initializer = symbol.initializer;
  if (!initializer || isMountSnapshotBinding(context, identifier)) return false;
  const initializerReferences = getDownstreamRefs(analysis, initializer);
  if (initializerReferences.some((initializerReference) => isRefCurrent(initializerReference))) {
    return false;
  }
  return !isConstantBooleanExpression(context, initializer);
};

const areSameProvenLiveBinding = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  left: EsTreeNode,
  right: EsTreeNode,
): boolean => {
  const leftExpression = stripParenExpression(left);
  const rightExpression = stripParenExpression(right);
  if (!isNodeOfType(leftExpression, "Identifier") || !isNodeOfType(rightExpression, "Identifier")) {
    return false;
  }
  const leftSymbol = context.scopes.symbolFor(leftExpression);
  const rightSymbol = context.scopes.symbolFor(rightExpression);
  return Boolean(
    leftSymbol &&
    leftSymbol === rightSymbol &&
    isProvenLiveBinding(analysis, context, leftExpression),
  );
};

const haveSameLivePropExpressionIdentity = (
  left: LivePropExpressionIdentity,
  right: LivePropExpressionIdentity,
): boolean => {
  if (
    left.propSymbolId !== right.propSymbolId ||
    left.booleanNormalization !== right.booleanNormalization ||
    left.memberPath.length !== right.memberPath.length
  ) {
    return false;
  }
  return left.memberPath.every((propertyName, index) => propertyName === right.memberPath[index]);
};

const isSetStateToInitialValue = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  setterRef: Reference,
): boolean => {
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
  if (stateInitialValue && setStateToValue) {
    const initialLivePropIdentity = getLivePropExpressionIdentity(
      analysis,
      context,
      stateInitialValue,
    );
    const nextLivePropIdentity = getLivePropExpressionIdentity(analysis, context, setStateToValue);
    if (
      initialLivePropIdentity &&
      nextLivePropIdentity &&
      haveSameLivePropExpressionIdentity(initialLivePropIdentity, nextLivePropIdentity)
    ) {
      return false;
    }
    if (areSameProvenLiveBinding(analysis, context, stateInitialValue, setStateToValue)) {
      return false;
    }
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
  context: RuleContext,
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

  const allResetToInitial = stateSetterRefs.every((ref) =>
    isSetStateToInitialValue(analysis, context, ref),
  );
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
        context,
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
