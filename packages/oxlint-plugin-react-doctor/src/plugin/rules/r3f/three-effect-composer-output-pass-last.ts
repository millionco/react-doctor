import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface ComposerPassAddition {
  readonly composerKey: string;
  readonly isOutputPass: boolean;
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly owner: EsTreeNode | null;
}

const getPassAddition = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): ComposerPassAddition | null => {
  if (
    !isNodeOfType(node.callee, "MemberExpression") ||
    getStaticPropertyName(node.callee) !== "addPass" ||
    getThreeConstructorName(node.callee.object, context.scopes) !== "EffectComposer"
  ) {
    return null;
  }
  const pass = node.arguments[0];
  if (!pass || isNodeOfType(pass, "SpreadElement")) return null;
  const composerKey = resolveExpressionKey(node.callee.object, context);
  if (!composerKey) return null;
  return {
    composerKey,
    isOutputPass: getThreeConstructorName(pass, context.scopes) === "OutputPass",
    node,
    owner: context.cfg.enclosingFunction(node),
  };
};

export const threeEffectComposerOutputPassLast = defineRule({
  id: "three-effect-composer-output-pass-last",
  title: "Postprocessing pass follows OutputPass",
  category: "Correctness",
  severity: "error",
  recommendation: "Add OutputPass after every other EffectComposer pass",
  create: (context: RuleContext) => {
    const additions: ComposerPassAddition[] = [];
    let program: EsTreeNodeOfType<"Program"> | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        program = node;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const addition = getPassAddition(node, context);
        if (addition) additions.push(addition);
      },
      "Program:exit"() {
        if (!program) return;
        const outputPassByPipeline = new Map<string, ComposerPassAddition>();
        for (const addition of additions.sort(
          (left, right) => (getRangeStart(left.node) ?? 0) - (getRangeStart(right.node) ?? 0),
        )) {
          if (isNodeConditionallyExecuted(addition.node, program)) continue;
          const ownerStart = addition.owner ? getRangeStart(addition.owner) : null;
          const pipelineKey = `${addition.composerKey}:${String(ownerStart ?? "program")}`;
          const previousOutputPass = outputPassByPipeline.get(pipelineKey);
          if (previousOutputPass) {
            context.report({
              node: addition.node,
              message:
                "This pass follows OutputPass, but OutputPass performs final tone mapping and color-space conversion and must be last in the EffectComposer chain",
            });
          }
          if (addition.isOutputPass) outputPassByPipeline.set(pipelineKey, addition);
        }
      },
    };
  },
});
