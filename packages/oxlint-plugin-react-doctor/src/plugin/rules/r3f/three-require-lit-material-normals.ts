import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  LIT_MATERIAL_CONSTRUCTOR_NAMES,
  THREE_MESH_GEOMETRY_ARGUMENT_INDEX,
  THREE_MESH_MATERIAL_ARGUMENT_INDEX,
} from "./constants.js";
import { getStaticThreeBufferGeometryAttributes } from "./utils/get-static-three-buffer-geometry-attributes.js";
import { getStaticThreeMaterialTextureProperties } from "./utils/get-static-three-material-texture-properties.js";
import { getStaticThreeMeshVisibility } from "./utils/get-static-three-mesh-visibility.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

export const threeRequireLitMaterialNormals = defineRule({
  id: "three-require-lit-material-normals",
  title: "Normal-mapped Three.js geometry has no normals",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Provide a normal BufferAttribute or call computeVertexNormals() before applying a normal map to custom geometry",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (getThreeConstructorName(node, context.scopes) !== "Mesh") return;
      const geometry = node.arguments[THREE_MESH_GEOMETRY_ARGUMENT_INDEX];
      const material = node.arguments[THREE_MESH_MATERIAL_ARGUMENT_INDEX];
      if (!geometry || !material) return;
      const materialName = getThreeConstructorName(material, context.scopes);
      if (!materialName || !LIT_MATERIAL_CONSTRUCTOR_NAMES.has(materialName)) return;
      const attributes = getStaticThreeBufferGeometryAttributes(geometry, node, context);
      const textureProperties = getStaticThreeMaterialTextureProperties(material, node, context);
      if (
        !attributes?.isComplete ||
        !textureProperties?.isComplete ||
        !textureProperties.isVisible ||
        getStaticThreeMeshVisibility(node, context) !== true ||
        !attributes.attributeNames.has("position") ||
        attributes.attributeNames.has("normal") ||
        !textureProperties.propertyNames.has("normalMap")
      ) {
        return;
      }
      context.report({
        node: geometry,
        message: `${materialName} applies a normalMap to this custom BufferGeometry, but the geometry defines positions without the normals needed to establish its normal basis`,
      });
    },
  }),
});
