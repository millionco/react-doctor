import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getExpectedTextureColorSpace } from "./utils/get-expected-texture-color-space.js";
import { getExplicitTextureColorSpaceAssignment } from "./utils/get-explicit-texture-color-space-assignment.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface TextureColorSpaceFact {
  readonly colorSpaceName: "NoColorSpace" | "SRGBColorSpace";
  readonly nodes: ReadonlyArray<EsTreeNode>;
}

const MATERIAL_TEXTURE_PROPERTY_NAMES: ReadonlyArray<string> = [
  "alphaMap",
  "aoMap",
  "bumpMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "displacementMap",
  "emissiveMap",
  "map",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "specularColorMap",
  "specularIntensityMap",
  "thicknessMap",
  "transmissionMap",
];

export const threeValidTextureColorSpace = defineRule({
  id: "three-valid-texture-color-space",
  title: "Three.js texture has an incompatible color space",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Use SRGBColorSpace for color maps and NoColorSpace for non-color material data maps",
  create: (context: RuleContext) => {
    const materialNodes: EsTreeNodeOfType<"NewExpression">[] = [];
    const assignmentsByTextureKey = new Map<string, TextureColorSpaceFact>();
    const renderTargetKeys = new Set<string>();
    const recordRenderTarget = (target: EsTreeNode, value: EsTreeNode): void => {
      const constructorName = getThreeConstructorName(value, context.scopes);
      const targetKey = resolveExpressionKey(target, context);
      if (targetKey && constructorName?.endsWith("RenderTarget")) renderTargetKeys.add(targetKey);
    };
    return {
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        recordRenderTarget(node.left, node.right);
        const assignment = getExplicitTextureColorSpaceAssignment(node, context);
        if (!assignment) return;
        const previous = assignmentsByTextureKey.get(assignment.textureKey);
        assignmentsByTextureKey.set(assignment.textureKey, {
          colorSpaceName: assignment.colorSpaceName,
          nodes: [...(previous?.nodes ?? []), assignment.node],
        });
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (getThreeConstructorName(node, context.scopes)?.endsWith("Material")) {
          materialNodes.push(node);
        }
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (node.init) recordRenderTarget(node.id, node.init);
      },
      "Program:exit"() {
        for (const materialNode of materialNodes) {
          const parameters = materialNode.arguments[0];
          if (!parameters || parameters.type === "SpreadElement") continue;
          for (const propertyName of MATERIAL_TEXTURE_PROPERTY_NAMES) {
            const textureExpression = getStaticObjectPropertyValue(parameters, propertyName);
            if (!textureExpression) continue;
            const textureMember = stripParenExpression(textureExpression);
            if (
              isNodeOfType(textureMember, "MemberExpression") &&
              getStaticPropertyName(textureMember) === "texture" &&
              renderTargetKeys.has(resolveExpressionKey(textureMember.object, context) ?? "")
            ) {
              continue;
            }
            const textureKey = resolveExpressionKey(textureExpression, context);
            const assignment = textureKey ? assignmentsByTextureKey.get(textureKey) : undefined;
            const expectedColorSpace = getExpectedTextureColorSpace(propertyName);
            if (
              !assignment ||
              assignment.nodes.length !== 1 ||
              !expectedColorSpace ||
              assignment.colorSpaceName === expectedColorSpace
            ) {
              continue;
            }
            context.report({
              node: textureExpression,
              message: `${propertyName} stores ${expectedColorSpace === "SRGBColorSpace" ? "color" : "non-color data"}, but this texture is explicitly tagged ${assignment.colorSpaceName}; use ${expectedColorSpace}`,
            });
          }
        }
      },
    };
  },
});
