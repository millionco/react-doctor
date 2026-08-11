import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectGlslGlobalDeclarations } from "./utils/collect-glsl-global-declarations.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const NONINITIALIZABLE_STORAGE_QUALIFIERS: ReadonlySet<string> = new Set([
  "attribute",
  "buffer",
  "in",
  "out",
  "shared",
  "uniform",
  "varying",
]);

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  for (const declaration of collectGlslGlobalDeclarations(shader.program)) {
    const invalidStorageQualifier = [...declaration.qualifiers].find((qualifier) =>
      NONINITIALIZABLE_STORAGE_QUALIFIERS.has(qualifier),
    );
    if (declaration.hasInitializer && invalidStorageQualifier) {
      context.report({
        node: shader.source.getOriginNodeAtOffset(declaration.node.location?.start.offset ?? 0),
        message: `Global ${invalidStorageQualifier} variable ${declaration.name} cannot have a GLSL initializer`,
      });
      continue;
    }
    if (!declaration.hasInitializer && declaration.qualifiers.has("const")) {
      context.report({
        node: shader.source.getOriginNodeAtOffset(declaration.node.location?.start.offset ?? 0),
        message: `Global const variable ${declaration.name} must be initialized where it is declared`,
      });
    }
  }
};

export const threeShaderValidGlobalInitializers = defineRule({
  id: "three-shader-valid-global-initializers",
  title: "Shader global has an invalid initializer",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Remove initializers from interface variables and initialize every const declaration",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (!material) return;
      if (material.vertexShader) checkShader(material.vertexShader, context);
      if (material.fragmentShader) checkShader(material.fragmentShader, context);
    },
  }),
});
