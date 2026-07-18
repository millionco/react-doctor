import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getTransparentReactCallbackWrapperArgument } from "../../utils/get-transparent-react-callback-wrapper-argument.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isResultDiscardedCall } from "../../utils/is-result-discarded-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Reference } from "eslint-scope";
import { walkInsideStatementBlocks } from "../../utils/walk-inside-statement-blocks.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRef, getUpstreamRefs } from "./utils/effect/ast.js";
import { isExternallyDrivenState } from "./utils/effect/external-state.js";
import { getProgramAnalysis, type ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { isProp, isState } from "./utils/effect/react.js";
import { getParentCallbackPropNames } from "./utils/resolve-parent-callback-provenance.js";
import { isCustomHookStateResultReference } from "./utils/is-custom-hook-state-result-reference.js";

// The ref-latch shape: the effect reads a `<ref>.current` in an
// if-guard AND writes that same `<ref>.current`. That is the one-shot
// completion-signal idiom (docs-validation r2: AlbumRow
// notifyRestoreCompletePendingRef, CanonCard settledRef) — the latch
// blocks every run but the first, so the "parent re-renders on every
// local state change" premise is false and a Provider cannot replace a
// completion event.
const isRefLatchGuardedEffect = (callbackBody: EsTreeNode): boolean => {
  const refNamesReadInGuards = new Set<string>();
  const refNamesWritten = new Set<string>();
  const collectCurrentReads = (expression: EsTreeNode, out: Set<string>): void => {
    walkInsideStatementBlocks(expression, (child: EsTreeNode) => {
      if (
        isNodeOfType(child, "MemberExpression") &&
        isNodeOfType(child.property, "Identifier") &&
        child.property.name === "current" &&
        isNodeOfType(child.object, "Identifier")
      ) {
        out.add(child.object.name);
      }
    });
  };
  walkInsideStatementBlocks(callbackBody, (child: EsTreeNode) => {
    if (isNodeOfType(child, "IfStatement") && child.test) {
      collectCurrentReads(child.test as EsTreeNode, refNamesReadInGuards);
    }
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "MemberExpression") &&
      isNodeOfType(child.left.property, "Identifier") &&
      child.left.property.name === "current" &&
      isNodeOfType(child.left.object, "Identifier")
    ) {
      refNamesWritten.add(child.left.object.name);
    }
  });
  for (const refName of refNamesReadInGuards) {
    if (refNamesWritten.has(refName)) return true;
  }
  return false;
};

// An edge-triggered transition detector: one of the deps is a
// `usePrevious(...)` binding, so the effect compares previous vs
// current and fires the parent callback only on the transition
// (docs-validation r2: LocalSetupPanel prevHadMissing). That is a
// one-shot notification, not a continuous state mirror.
const PREVIOUS_VALUE_HOOK_PATTERN = /^usePrev/i;

const hasPreviousValueDep = (
  effectNode: EsTreeNode,
  depElements: readonly EsTreeNode[],
): boolean => {
  for (const element of depElements) {
    if (!isNodeOfType(element, "Identifier")) continue;
    const binding = findVariableInitializer(effectNode, element.name);
    if (!binding?.initializer || !isNodeOfType(binding.initializer, "CallExpression")) continue;
    const calleeName = getCalleeName(binding.initializer);
    if (calleeName && PREVIOUS_VALUE_HOOK_PATTERN.test(calleeName)) return true;
  }
  return false;
};

const isStateLikeDependency = (
  analysis: ProgramAnalysis | null,
  element: EsTreeNode,
  isPropName: (name: string) => boolean,
): boolean => {
  if (!isNodeOfType(element, "Identifier") || isPropName(element.name)) return false;
  if (!analysis) return true;
  const reference = getRef(analysis, element);
  if (!reference) return true;
  if (isCustomHookStateResultReference(analysis, reference)) return true;
  const upstreamReferences = getUpstreamRefs(analysis, reference);
  if (upstreamReferences.some((upstreamReference) => isState(analysis, upstreamReference))) {
    return true;
  }
  return !upstreamReferences.some((upstreamReference) => isProp(analysis, upstreamReference));
};

const getRefHeldPropCallbackName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  isPropName: (name: string) => boolean,
): string | null => {
  const callee = stripParenExpression(callExpression.callee as EsTreeNode);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "current"
  ) {
    return null;
  }
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const binding = findVariableInitializer(callExpression, receiver.name);
  if (!binding?.initializer || !isNodeOfType(binding.initializer, "CallExpression")) return null;
  if (getCalleeName(binding.initializer) !== "useRef") return null;
  const callbackArgument = binding.initializer.arguments?.[0];
  if (!callbackArgument || !isNodeOfType(callbackArgument, "Identifier")) return null;
  return isPropName(callbackArgument.name) ? callbackArgument.name : null;
};

const getTransparentWrappedPropCallbackName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  isPropName: (name: string, referenceNode?: EsTreeNode) => boolean,
): string | null => {
  const callee = stripParenExpression(callExpression.callee as EsTreeNode);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const binding = findVariableInitializer(callExpression, callee.name);
  if (!binding?.initializer) return null;
  const resultSymbol = context.scopes.symbolFor(callee);
  const callbackArgument = getTransparentReactCallbackWrapperArgument(
    binding.initializer,
    resultSymbol,
    context.scopes,
  );
  if (!callbackArgument) return null;
  const callbackSource = stripParenExpression(callbackArgument);
  if (isNodeOfType(callbackSource, "Identifier")) {
    return isPropName(callbackSource.name, callbackSource) ? callbackSource.name : null;
  }
  if (!isNodeOfType(callbackSource, "MemberExpression")) return null;
  const receiver = stripParenExpression(callbackSource.object as EsTreeNode);
  const propertyName = getStaticPropertyName(callbackSource);
  if (!isNodeOfType(receiver, "Identifier") || !propertyName) return null;
  return isPropName(receiver.name, receiver) ? propertyName : null;
};

// HACK: `useEffect(() => parentCallback(state.x), [state.x])` is the
// "lift state up via callback" anti-pattern: the child owns state, then
// fires a parent callback every time the state changes to keep the
// parent in sync. The parent has no real ground-truth state, just a
// stale mirror. The right shape is to lift state into a Provider that
// both child and parent read from; the child then doesn't need an
// effect-driven sync at all.
export const noPropCallbackInEffect = defineRule({
  id: "no-prop-callback-in-effect",
  title: "Parent kept in sync with a callback effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Move the shared state into a Provider so both sides read the same value. Then you don't need a useEffect to keep them in sync.",
  create: (context: RuleContext) => {
    const propStackTracker = createComponentPropStackTracker();

    return {
      ...propStackTracker.visitors,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isReactHookCall(node, EFFECT_HOOK_NAMES, context.scopes) ||
          (node.arguments?.length ?? 0) < 2
        ) {
          return;
        }
        const callback = getEffectCallback(node);
        if (
          !callback ||
          (!isNodeOfType(callback, "ArrowFunctionExpression") &&
            !isNodeOfType(callback, "FunctionExpression"))
        )
          return;
        const depsNode = node.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression") || !depsNode.elements?.length) return;
        const analysis = getProgramAnalysis(node);

        // Only flag if at least one dep is a non-prop (state-shape)
        // identifier — otherwise the effect is just adapting to prop
        // changes (legit pattern).
        const stateLikeDeps = (depsNode.elements ?? []).filter(
          (element) =>
            element &&
            isStateLikeDependency(analysis, element as EsTreeNode, propStackTracker.isPropName),
        );
        if (stateLikeDeps.length === 0) return;

        if (isRefLatchGuardedEffect(callback.body as EsTreeNode)) return;
        if (hasPreviousValueDep(node, (depsNode.elements ?? []) as readonly EsTreeNode[])) return;

        // When every state-shape dep is driven by a timer / listener /
        // observer / subscription, the parent callback bridges an imperative
        // browser event, not a local state mirror — moving it into a Provider
        // wouldn't remove the effect.
        if (analysis) {
          const stateLikeDepRefs: Reference[] = [];
          for (const element of stateLikeDeps) {
            const depRef = getRef(analysis, element as unknown as EsTreeNode);
            if (depRef) stateLikeDepRefs.push(depRef);
          }
          if (
            stateLikeDepRefs.length === stateLikeDeps.length &&
            stateLikeDepRefs.every((depRef) => isExternallyDrivenState(analysis, depRef))
          ) {
            return;
          }
        }

        // HACK: walk control-flow descendants (`if`, `try`, `for`,
        // `switch`) but stop at any nested function boundary so calls
        // inside `setTimeout(() => onChange(state))` aren't conflated
        // with the top-level `onChange(state)` shape — those belong to
        // `prefer-use-effect-event` (sub-handler reads), not this rule
        // (lift state via callback).
        const reportedNodes = new Set<EsTreeNode>();
        walkInsideStatementBlocks(callback.body, (child: EsTreeNode) => {
          if (!isNodeOfType(child, "CallExpression")) return;
          const directCallee = stripParenExpression(child.callee as EsTreeNode);
          const resolvedCallbackPropNames =
            analysis && propStackTracker.getCurrentPropNames().size > 0
              ? getParentCallbackPropNames({
                  analysis,
                  expression: directCallee,
                  scopes: context.scopes,
                })
              : null;
          const calleeName =
            (resolvedCallbackPropNames && [...resolvedCallbackPropNames][0]) ||
            (isNodeOfType(directCallee, "Identifier") &&
              propStackTracker.isPropName(directCallee.name) &&
              directCallee.name) ||
            getRefHeldPropCallbackName(child, propStackTracker.isPropName) ||
            getTransparentWrappedPropCallbackName(child, context, propStackTracker.isPropName);
          if (!calleeName) return;
          // Only the "lift state up" hand-back fires: a discarded
          // `onChange(state)`. When the prop call's result flows somewhere
          // (`setError(validate(value))`) the prop is a pure transform consumed
          // locally, not a parent sync — leave it alone.
          const callExpressionRoot = findTransparentExpressionRoot(child);
          const isDirectEffectReturn =
            isNodeOfType(callExpressionRoot.parent, "ReturnStatement") &&
            callExpressionRoot.parent.parent === callback.body;
          if (!isResultDiscardedCall(child) && !isDirectEffectReturn) return;
          if (reportedNodes.has(child)) return;
          reportedNodes.add(child);
          context.report({
            node: child,
            message: `Your parent re-renders on every local state change because this useEffect calls the prop "${calleeName}" just to stay in sync.`,
          });
        });
      },
    };
  },
});
