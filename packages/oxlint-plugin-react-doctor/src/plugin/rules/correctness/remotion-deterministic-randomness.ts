import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { createRemotionRenderEvidenceChecker } from "../../utils/create-remotion-render-evidence-checker.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { functionHasReactComponentEvidence } from "../../utils/function-has-react-component-evidence.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isGlobalMathObject = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(node);
  if (isNodeOfType(candidate, "Identifier")) {
    return candidate.name === "Math" && scopes.isGlobalReference(candidate);
  }
  return Boolean(
    isNodeOfType(candidate, "MemberExpression") &&
    getStaticPropertyKeyName(candidate, { allowComputedString: true }) === "Math" &&
    isNodeOfType(candidate.object, "Identifier") &&
    candidate.object.name === "globalThis" &&
    scopes.isGlobalReference(candidate.object),
  );
};

export const remotionDeterministicRandomness = defineRule({
  id: "remotion-deterministic-randomness",
  title: "Randomness changes between rendered frames",
  tags: ["react-jsx-only"],
  requires: ["remotion:4"],
  severity: "error",
  recommendation:
    "Use Remotion's seeded `random(seed)` helper so the same frame produces the same value in every render tab.",
  create: (context) => {
    const renderEvidence = createRemotionRenderEvidenceChecker(context);
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callee = stripParenExpression(node.callee);
        if (
          !isNodeOfType(callee, "MemberExpression") ||
          getStaticPropertyKeyName(callee, { allowComputedString: true }) !== "random" ||
          !isGlobalMathObject(callee.object, context.scopes)
        ) {
          return;
        }
        const componentOrHook =
          findRenderPhaseComponentOrHook(node, context.scopes) ?? findEnclosingFunction(node);
        if (!componentOrHook || !renderEvidence.functionHasEvidence(componentOrHook)) return;
        const displayName = componentOrHookDisplayNameForFunction(componentOrHook);
        if (
          displayName &&
          !isReactHookName(displayName) &&
          !functionHasReactComponentEvidence(componentOrHook, context.scopes, context.cfg)
        ) {
          return;
        }
        context.report({
          node,
          message:
            "`Math.random()` can return a different value in each parallel Remotion render tab, so the same frame is not deterministic. Use `random(seed)` from `remotion` instead.",
        });
      },
    };
  },
});
