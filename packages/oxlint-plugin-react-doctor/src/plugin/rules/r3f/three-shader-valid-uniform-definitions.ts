import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getEffectiveObjectPropertiesInInsertionOrder } from "../../utils/get-effective-object-properties-in-insertion-order.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { resolveStableOptionsObject } from "../../utils/resolve-stable-options-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { resolveStaticShaderUniformsObject } from "./utils/resolve-static-shader-uniforms-object.js";
import { resolveStaticThreeUniformValue } from "./utils/resolve-static-three-uniform-value.js";
import { resolveStaticThreeShaderMaterial } from "./utils/resolve-static-three-shader-material.js";

const PROVABLY_INVALID_UNIFORM_DEFINITION_TYPES: ReadonlySet<string> = new Set([
  "ArrayExpression",
  "ArrowFunctionExpression",
  "FunctionExpression",
  "Literal",
  "TemplateLiteral",
]);

export const threeShaderValidUniformDefinitions = defineRule({
  id: "three-shader-valid-uniform-definitions",
  title: "Shader uniform has an invalid JavaScript definition",
  category: "Correctness",
  severity: "error",
  recommendation: "Define each ShaderMaterial uniform as { value: ... } or THREE.Uniform",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      const uniformsExpression = material?.properties.get("uniforms");
      if (!material || !uniformsExpression) return;
      const uniformsObject = resolveStaticShaderUniformsObject(
        uniformsExpression,
        material.constructorNode,
        context,
      );
      if (!uniformsObject) return;
      const properties = getEffectiveObjectPropertiesInInsertionOrder(uniformsObject.properties);
      if (!properties) return;
      for (const property of properties) {
        const uniformName = getStaticPropertyKeyName(property, { allowComputedString: true });
        if (!uniformName || property.kind !== "init" || property.method) continue;
        if (
          resolveStaticThreeUniformValue(property.value, material.constructorNode, context) ||
          (!PROVABLY_INVALID_UNIFORM_DEFINITION_TYPES.has(
            stripParenExpression(property.value).type,
          ) &&
            !resolveStableOptionsObject(
              property.value,
              ["value"],
              context.scopes,
              material.constructorNode,
            ))
        ) {
          continue;
        }
        context.report({
          node: property.value,
          message: `Uniform ${uniformName} is not a { value: ... } definition, so Three.js cannot upload its value`,
        });
      }
    },
  }),
});
