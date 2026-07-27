import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";
import { maskGlslComments } from "./utils/mask-glsl-comments.js";

const VERSION_DIRECTIVE_PATTERN = /^[ \t]*#[ \t]*version\b/m;

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  const versionDirectiveOffset = maskGlslComments(shader.source.text).search(
    VERSION_DIRECTIVE_PATTERN,
  );
  if (versionDirectiveOffset < 0) return;
  context.report({
    node: shader.source.getOriginNodeAtOffset(versionDirectiveOffset),
    message:
      "Three.js prepends its own shader prefix before custom source, so an inline #version directive is not first and cannot compile. Set the material glslVersion property instead",
  });
};

export const threeShaderNoVersionDirective = defineRule({
  id: "three-shader-no-version-directive",
  title: "Three shader source contains a version directive",
  category: "Correctness",
  severity: "error",
  recommendation: "Set glslVersion on the material instead of writing #version in shader source",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      if (material.fragmentShader) checkShader(material.fragmentShader, context);
      if (material.vertexShader) checkShader(material.vertexShader, context);
    },
  }),
});
