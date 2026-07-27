import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { doesGlslMainWritePositionOnAllPaths } from "./utils/does-glsl-main-write-position-on-all-paths.js";
import { resolveStaticThreeShaderMaterial } from "./utils/resolve-static-three-shader-material.js";

export const threeShaderRequirePositionOnAllPaths = defineRule({
  id: "three-shader-require-position-on-all-paths",
  title: "Vertex shader leaves gl_Position undefined",
  category: "Correctness",
  severity: "error",
  recommendation: "Assign gl_Position before every return and on every path through main",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material?.vertexShader) return;
      const analysis = doesGlslMainWritePositionOnAllPaths(
        material.vertexShader.program,
        material.vertexShader.source.text,
      );
      if (!analysis.mainFunction || analysis.writesPositionOnAllPaths !== false) {
        return;
      }
      context.report({
        node: material.vertexShader.source.getOriginNodeAtOffset(
          analysis.mainFunction.location?.start.offset ?? 0,
        ),
        message:
          "At least one path through vertex main returns or falls through without assigning gl_Position, leaving the clip-space position undefined",
      });
    },
  }),
});
