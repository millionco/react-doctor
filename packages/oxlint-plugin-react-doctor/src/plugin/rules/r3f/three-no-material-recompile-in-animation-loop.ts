import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { visitThreeAnimationLoopEnabledPropertyWrites } from "./utils/visit-three-animation-loop-enabled-property-writes.js";

const MATERIAL_RECOMPILE_PROPERTY_NAMES: ReadonlySet<string> = new Set(["needsUpdate"]);

export const threeNoMaterialRecompileInAnimationLoop = defineRule({
  id: "three-no-material-recompile-in-animation-loop",
  title: "Material recompiled inside animation loop",
  category: "Performance",
  severity: "error",
  recommendation:
    "Change material defines or features outside the animation loop and set needsUpdate only when the compiled program must change",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        visitThreeAnimationLoopEnabledPropertyWrites(
          node,
          context.scopes,
          MATERIAL_RECOMPILE_PROPERTY_NAMES,
          analyzedCallbacks,
          ({ constructorName, node: assignment }) => {
            if (!constructorName.endsWith("Material")) return;
            context.report({
              node: assignment,
              message:
                "Setting material.needsUpdate every frame forces Three.js to reconsider and often rebuild the GPU program. Set it only after a shader-affecting material change",
            });
          },
        );
      },
    };
  },
});
