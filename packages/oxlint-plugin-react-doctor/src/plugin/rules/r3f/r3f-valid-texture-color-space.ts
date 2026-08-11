import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getExpectedTextureColorSpace } from "./utils/get-expected-texture-color-space.js";
import { getExplicitTextureColorSpaceAssignment } from "./utils/get-explicit-texture-color-space-assignment.js";
import { getJsxAttributeExpression } from "./utils/get-jsx-attribute-expression.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";

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

export const r3fValidTextureColorSpace = defineRule({
  id: "r3f-valid-texture-color-space",
  title: "R3F texture has an incompatible color space",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Use SRGBColorSpace for color maps and NoColorSpace for non-color material data maps",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    const assignmentsByTextureKey = new Map<string, TextureColorSpaceFact>();
    const materialNodes: EsTreeNodeOfType<"JSXOpeningElement">[] = [];
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        const assignment = getExplicitTextureColorSpaceAssignment(node, context);
        if (!assignment) return;
        const previous = assignmentsByTextureKey.get(assignment.textureKey);
        assignmentsByTextureKey.set(assignment.textureKey, {
          colorSpaceName: assignment.colorSpaceName,
          nodes: [...(previous?.nodes ?? []), assignment.node],
        });
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !isNodeOfType(node.name, "JSXIdentifier") ||
          !isR3fHostIntrinsic(node)
        ) {
          return;
        }
        const elementType = resolveJsxElementType(node);
        if (elementType?.endsWith("Material")) materialNodes.push(node);
      },
      "Program:exit"() {
        for (const materialNode of materialNodes) {
          for (const propertyName of MATERIAL_TEXTURE_PROPERTY_NAMES) {
            const textureExpression = getJsxAttributeExpression(materialNode, propertyName);
            if (!textureExpression) continue;
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
