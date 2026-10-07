import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { visitThreeAnimationLoopEnabledPropertyWrites } from "./utils/visit-three-animation-loop-enabled-property-writes.js";

const UNIFORM_UPDATE_PROPERTY_NAMES: ReadonlySet<string> = new Set(["uniformsNeedUpdate"]);

export const threeNoRedundantUniformsNeedUpdate = defineRule({
  id: "three-no-redundant-uniforms-need-update",
  title: "Redundant uniformsNeedUpdate inside animation loop",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Mutate ShaderMaterial uniform values directly; Three.js uploads custom uniforms during rendering",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        visitThreeAnimationLoopEnabledPropertyWrites(
          node,
          context.scopes,
          UNIFORM_UPDATE_PROPERTY_NAMES,
          analyzedCallbacks,
          ({ constructorName, node: assignment }) => {
            if (constructorName !== "ShaderMaterial" && constructorName !== "RawShaderMaterial") {
              return;
            }
            context.report({
              node: assignment,
              message:
                "Shader material custom uniforms are refreshed during rendering, so setting uniformsNeedUpdate on every animation frame is redundant",
            });
          },
        );
      },
    };
  },
});
