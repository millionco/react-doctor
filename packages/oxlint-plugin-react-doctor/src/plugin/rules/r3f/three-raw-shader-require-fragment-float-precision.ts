import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import type { AstNode } from "@shaderfrog/glsl-parser/ast/ast-types.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getGlslTypeSpecifierName } from "./utils/get-glsl-type-specifier-name.js";
import { resolveStaticThreeShaderMaterial } from "./utils/resolve-static-three-shader-material.js";

const FLOAT_TYPE_NAME_PATTERN = /^(?:float|vec[234]|mat[234](?:x[234])?)$/;
const PRECISION_QUALIFIER_NAMES: ReadonlySet<string> = new Set(["highp", "lowp", "mediump"]);

const hasPrecisionQualifier = (qualifiers: readonly AstNode[] | null | undefined): boolean =>
  Boolean(
    qualifiers?.some(
      (qualifier) => qualifier.type === "keyword" && PRECISION_QUALIFIER_NAMES.has(qualifier.token),
    ),
  );

export const threeRawShaderRequireFragmentFloatPrecision = defineRule({
  id: "three-raw-shader-require-fragment-float-precision",
  title: "Raw fragment shader lacks float precision",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Declare a default fragment float precision or qualify every floating-point declaration",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (material?.constructorName !== "RawShaderMaterial" || !material.fragmentShader) {
        return;
      }
      let hasDefaultFloatPrecision = false;
      const unqualifiedFloatNodes: AstNode[] = [];
      visit(material.fragmentShader.program, {
        precision: {
          enter: ({ node: precision }) => {
            if (getGlslTypeSpecifierName(precision.specifier) === "float") {
              hasDefaultFloatPrecision = true;
            }
          },
        },
        fully_specified_type: {
          enter: ({ node: specifiedType }) => {
            const typeName = getGlslTypeSpecifierName(specifiedType.specifier);
            if (
              unqualifiedFloatNodes.length === 0 &&
              !hasDefaultFloatPrecision &&
              typeName &&
              FLOAT_TYPE_NAME_PATTERN.test(typeName) &&
              !hasPrecisionQualifier(specifiedType.qualifiers)
            ) {
              unqualifiedFloatNodes.push(specifiedType);
            }
          },
        },
        parameter_declaration: {
          enter: ({ node: parameter }) => {
            const typeName = getGlslTypeSpecifierName(parameter.specifier);
            if (
              unqualifiedFloatNodes.length === 0 &&
              !hasDefaultFloatPrecision &&
              typeName &&
              FLOAT_TYPE_NAME_PATTERN.test(typeName) &&
              !hasPrecisionQualifier(parameter.qualifier)
            ) {
              unqualifiedFloatNodes.push(parameter);
            }
          },
        },
      });
      const firstUnqualifiedFloatNode = unqualifiedFloatNodes[0];
      if (!firstUnqualifiedFloatNode) return;
      context.report({
        node: material.fragmentShader.source.getOriginNodeAtOffset(
          firstUnqualifiedFloatNode.location?.start.offset ?? 0,
        ),
        message:
          "RawShaderMaterial does not receive Three.js precision declarations, and fragment GLSL has no default float precision for this unqualified declaration",
      });
    },
  }),
});
