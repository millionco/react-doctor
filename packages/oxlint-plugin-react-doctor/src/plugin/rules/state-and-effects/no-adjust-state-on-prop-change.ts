import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import {
  collectEffectStateWriteFacts,
  type EffectStateWriteFact,
} from "./utils/collect-effect-state-write-facts.js";
import { getRef, getUpstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import type { ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getEffectDepsRefs, hasCleanup, isProp, isState } from "./utils/effect/react.js";
import { hasDeferredOrExternalEffectWork } from "./utils/has-deferred-or-external-effect-work.js";
import { hasResourceLifecycleSetterWriter } from "./utils/has-resource-lifecycle-setter-writer.js";

const writesPropDerivedValue = (analysis: ProgramAnalysis, fact: EffectStateWriteFact): boolean => {
  if (fact.writesPropDerivedMemberValue) return true;
  if (
    fact.sourceReferences.some((reference) =>
      getUpstreamRefs(analysis, reference).some((upstreamReference) =>
        isProp(analysis, upstreamReference),
      ),
    )
  ) {
    return true;
  }
  if (!isNodeOfType(fact.callExpression, "CallExpression")) return false;
  const writtenValue = fact.callExpression.arguments?.[0];
  if (!writtenValue) return false;
  let currentExpression = stripParenExpression(writtenValue as EsTreeNode);
  if (isFunctionLike(currentExpression) && "body" in currentExpression) {
    const functionBody: EsTreeNode = currentExpression.body;
    let readsPropDerivedValue = false;
    walkAst(functionBody, (child): boolean | void => {
      if (readsPropDerivedValue) return false;
      if (child !== functionBody && isFunctionLike(child)) return false;
      if (!isNodeOfType(child, "Identifier")) return;
      const reference = getRef(analysis, child);
      if (
        reference &&
        getUpstreamRefs(analysis, reference).some((upstreamReference) =>
          isProp(analysis, upstreamReference),
        )
      ) {
        readsPropDerivedValue = true;
        return false;
      }
    });
    return readsPropDerivedValue;
  }
  if (currentExpression.type !== "MemberExpression") return false;
  while (currentExpression.type === "MemberExpression") {
    currentExpression = stripParenExpression(currentExpression.object as EsTreeNode);
  }
  if (currentExpression.type !== "Identifier") return false;
  const reference = getRef(analysis, currentExpression);
  return Boolean(
    reference &&
    getUpstreamRefs(analysis, reference).some((upstreamReference) =>
      isProp(analysis, upstreamReference),
    ),
  );
};

export const noAdjustStateOnPropChange = defineRule({
  id: "no-adjust-state-on-prop-change",
  title: "State adjusted after a prop changes",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Remove the adjustment effect by deriving values during render, resetting the component with a key, or updating related state in the event that changes the prop. Avoid tracking the previous prop in more state, which preserves the duplication. See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, "useEffect", context.scopes)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const dependencyReferences = getEffectDepsRefs(analysis, node);
      if (!dependencyReferences) return;
      const hasPropDependency = dependencyReferences
        .flatMap((reference) =>
          isState(analysis, reference) ? [] : getUpstreamRefs(analysis, reference),
        )
        .some((reference) => isProp(analysis, reference));
      if (!hasPropDependency) return;
      const facts = collectEffectStateWriteFacts(analysis, context, node, context.filename);
      if (hasCleanup(analysis, node)) return;
      for (const fact of facts) {
        if (
          fact.isDeferred ||
          hasDeferredOrExternalEffectWork(analysis, node, context, fact.callExpression)
        ) {
          continue;
        }
        if (
          fact.matchesStateInitializer &&
          hasResourceLifecycleSetterWriter(
            analysis,
            context,
            fact.setterReference,
            node,
            dependencyReferences,
          )
        ) {
          continue;
        }
        const isEventOwnedPropDerivedAdjustment =
          fact.hasIndependentWriter &&
          fact.readsWrittenState &&
          writesPropDerivedValue(analysis, fact);
        if (
          (!fact.isSynchronousRenderValue && !isEventOwnedPropDerivedAdjustment) ||
          fact.resetsSourceState
        ) {
          continue;
        }
        const writtenValueHasPropSource = fact.sourceReferences
          .flatMap((reference) => getUpstreamRefs(analysis, reference))
          .some((reference) => isProp(analysis, reference));
        if (writtenValueHasPropSource && !isEventOwnedPropDerivedAdjustment) {
          continue;
        }
        context.report({
          node: fact.callExpression,
          message:
            "This effect adjusts state after a prop changes, so users briefly see the stale value.",
        });
      }
    },
  }),
});
