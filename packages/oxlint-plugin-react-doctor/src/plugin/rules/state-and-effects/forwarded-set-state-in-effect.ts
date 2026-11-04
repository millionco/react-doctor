import {
  REACT_COMPILER_EFFECT_HOOK_NAMES,
  REACT_COMPILER_SET_STATE_IN_EFFECT_DESCRIPTION,
  REACT_COMPILER_SET_STATE_IN_EFFECT_REASON,
} from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
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
import { isProvenReactRefCurrentSnapshotExpression } from "./utils/resolve-parent-callback-provenance.js";

const MESSAGE = `${REACT_COMPILER_SET_STATE_IN_EFFECT_REASON}\n\n${REACT_COMPILER_SET_STATE_IN_EFFECT_DESCRIPTION}.`;

const isStateSetterCallee = (analysis: ProgramAnalysis, callee: EsTreeNode): boolean => {
  const expression = stripParenExpression(callee);
  if (!isNodeOfType(expression, "Identifier")) return false;
  const reference = getRef(analysis, expression);
  return Boolean(reference && resolveStateSetterReference(analysis, reference));
};

interface CompilerEffectAnalysis {
  readonly refDerivedValues: WeakMap<EsTreeNode, boolean>;
  readonly synchronousCalls: WeakMap<EsTreeNode, ReadonlyArray<EsTreeNode>>;
  readonly compilerVisibleFunctions: WeakMap<EsTreeNode, boolean>;
}

const compilerEffectAnalyses = new WeakMap<ProgramAnalysis, CompilerEffectAnalysis>();

const getCompilerEffectAnalysis = (analysis: ProgramAnalysis): CompilerEffectAnalysis => {
  let compilerAnalysis = compilerEffectAnalyses.get(analysis);
  if (!compilerAnalysis) {
    compilerAnalysis = {
      refDerivedValues: new WeakMap(),
      synchronousCalls: new WeakMap(),
      compilerVisibleFunctions: new WeakMap(),
    };
    compilerEffectAnalyses.set(analysis, compilerAnalysis);
  }
  return compilerAnalysis;
};

const isRefDerived = (
  node: EsTreeNode,
  analysis: ProgramAnalysis,
  context: RuleContext,
): boolean => {
  const cache = getCompilerEffectAnalysis(analysis).refDerivedValues;
  const cachedResult = cache.get(node);
  if (cachedResult !== undefined) return cachedResult;
  cache.set(node, false);
  let didFindRef = false;
  walkAst(node, (child: EsTreeNode): boolean | void => {
    if (didFindRef) return false;
    if (
      isReactApiCall(child, "useRef", context.scopes, {
        allowGlobalReactNamespace: true,
        allowUnboundBareCalls: true,
      }) ||
      isProvenReactRefCurrentSnapshotExpression({
        analysis,
        expression: child,
        scopes: context.scopes,
      })
    ) {
      didFindRef = true;
      return false;
    }
    if (!isNodeOfType(child, "Identifier") || !getRef(analysis, child)) return;
    const symbol = context.scopes.symbolFor(child);
    if (
      symbol?.kind === "const" &&
      symbol.initializer &&
      symbol.references.every((reference) => reference.flag === "read") &&
      isRefDerived(symbol.initializer, analysis, context)
    ) {
      didFindRef = true;
      return false;
    }
  });
  cache.set(node, didFindRef);
  return didFindRef;
};

const isRefControlled = (
  node: EsTreeNode,
  effectFunction: EsTreeNode,
  analysis: ProgramAnalysis,
  context: RuleContext,
): boolean => {
  let child = node;
  let ancestor = node.parent;
  while (ancestor && child !== effectFunction) {
    let test: EsTreeNode | null = null;
    if (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) {
      test = ancestor.test;
    } else if (isNodeOfType(ancestor, "LogicalExpression")) {
      test = ancestor.left;
    }
    if (test && test !== child && isRefDerived(test, analysis, context)) return true;
    if (isNodeOfType(ancestor, "BlockStatement")) {
      for (const statement of ancestor.body) {
        if (statement === child) break;
        if (
          isNodeOfType(statement, "IfStatement") &&
          isRefDerived(statement.test, analysis, context) &&
          (statementAlwaysExits(statement.consequent) ||
            (statement.alternate && statementAlwaysExits(statement.alternate)))
        ) {
          return true;
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent;
  }
  return false;
};

const collectSynchronousCalls = (
  effectFunction: EsTreeNode,
  analysis: ProgramAnalysis,
): ReadonlyArray<EsTreeNode> => {
  const cache = getCompilerEffectAnalysis(analysis).synchronousCalls;
  const cachedCalls = cache.get(effectFunction);
  if (cachedCalls) return cachedCalls;
  const calls: EsTreeNode[] = [];
  walkAst(effectFunction, (child: EsTreeNode): boolean | void => {
    if (
      (child !== effectFunction && isFunctionLike(child)) ||
      isNodeOfType(child, "ClassDeclaration") ||
      isNodeOfType(child, "ClassExpression")
    )
      return false;
    if (isNodeOfType(child, "CallExpression")) {
      calls.push(child);
    }
  });
  cache.set(effectFunction, calls);
  return calls;
};

const isCompilerVisibleSetterCall = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  call: EsTreeNode,
  effectFunction: EsTreeNode,
): boolean => {
  if (!isNodeOfType(call, "CallExpression")) return false;
  if (isStateSetterCallee(analysis, call.callee)) {
    return (
      isNodeReachableWithinFunction(call, context) &&
      !isRefControlled(call, effectFunction, analysis, context)
    );
  }
  const localFunction = resolveExactLocalFunction(call.callee, context.scopes);
  if (
    !isFunctionLike(localFunction) ||
    localFunction.async ||
    localFunction.generator ||
    findEnclosingFunction(localFunction) === effectFunction
  )
    return false;
  const cache = getCompilerEffectAnalysis(analysis).compilerVisibleFunctions;
  let hasVisibleSetter = cache.get(localFunction);
  if (hasVisibleSetter === undefined) {
    hasVisibleSetter = false;
    cache.set(localFunction, false);
    for (const localCall of collectSynchronousCalls(localFunction, analysis)) {
      if (
        isNodeOfType(localCall, "CallExpression") &&
        isStateSetterCallee(analysis, localCall.callee) &&
        isNodeReachableWithinFunction(localCall, context) &&
        localCall.arguments[0] &&
        isRefDerived(localCall.arguments[0], analysis, context)
      )
        break;
      if (isCompilerVisibleSetterCall(analysis, context, localCall, localFunction)) {
        hasVisibleSetter = true;
        break;
      }
    }
    cache.set(localFunction, hasVisibleSetter);
  }
  return (
    hasVisibleSetter &&
    isNodeReachableWithinFunction(call, context) &&
    !isRefControlled(call, effectFunction, analysis, context)
  );
};

const findForwardedSetterInEffect = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  effectFunction: EsTreeNode,
): EsTreeNode | null => {
  const calls = collectSynchronousCalls(effectFunction, analysis);
  if (calls.some((call) => isCompilerVisibleSetterCall(analysis, context, call, effectFunction)))
    return null;
  for (const call of calls) {
    const forwardedWrite = resolveStateWriteSite(analysis, context, call);
    if (!forwardedWrite?.isForwardedWrite) continue;
    if (forwardedWrite.value && isRefDerived(forwardedWrite.value, analysis, context)) return null;
    if (isRefControlled(call, effectFunction, analysis, context)) continue;
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
      if (
        !effectFunction ||
        !isFunctionLike(effectFunction) ||
        effectFunction.async ||
        effectFunction.generator
      )
        return;
      const forwardedSetter = findForwardedSetterInEffect(analysis, context, effectFunction);
      if (!forwardedSetter) return;
      context.report({ node: forwardedSetter, message: MESSAGE });
    },
  }),
});
