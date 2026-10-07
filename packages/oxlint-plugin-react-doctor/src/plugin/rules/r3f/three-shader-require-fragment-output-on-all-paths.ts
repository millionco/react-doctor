import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { collectGlslGlobalDeclarations } from "./utils/collect-glsl-global-declarations.js";
import { doesGlslMainWriteVectorOnAllPaths } from "./utils/does-glsl-main-write-position-on-all-paths.js";
import { maskGlslComments } from "./utils/mask-glsl-comments.js";
import { resolveStaticThreeShaderMaterial } from "./utils/resolve-static-three-shader-material.js";

const getFragmentOutputNames = (
  source: string,
  program: Parameters<typeof collectGlslGlobalDeclarations>[0],
): string[] => {
  const outputNames = collectGlslGlobalDeclarations(program)
    .filter(
      (declaration) =>
        declaration.qualifiers.has("out") &&
        declaration.typeName === "vec4" &&
        declaration.arraySize === null &&
        declaration.isStaticallyUsed,
    )
    .map((declaration) => declaration.name);
  if (/\bgl_FragColor\b/.test(maskGlslComments(source))) {
    outputNames.push("gl_FragColor");
  }
  return [...new Set(outputNames)];
};

export const threeShaderRequireFragmentOutputOnAllPaths = defineRule({
  id: "three-shader-require-fragment-output-on-all-paths",
  title: "Fragment shader leaves a color output undefined",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Assign every used fragment color output before each return and on every non-discarded path",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      const shader = material?.fragmentShader;
      if (!shader) return;
      for (const outputName of getFragmentOutputNames(shader.source.text, shader.program)) {
        const analysis = doesGlslMainWriteVectorOnAllPaths(
          shader.program,
          shader.source.text,
          outputName,
        );
        if (!analysis.mainFunction || analysis.writesVectorOnAllPaths !== false) continue;
        context.report({
          node: shader.source.getOriginNodeAtOffset(
            analysis.mainFunction.location?.start.offset ?? 0,
          ),
          message: `At least one non-discarded path through fragment main leaves ${outputName} partially or completely undefined`,
        });
      }
    },
  }),
});
