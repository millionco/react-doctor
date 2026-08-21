import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  THREE_MESH_GEOMETRY_ARGUMENT_INDEX,
  THREE_MESH_MATERIAL_ARGUMENT_INDEX,
  UV_ATTRIBUTE_NAMES,
  UV_MAPPED_MATERIAL_CONSTRUCTOR_NAMES,
} from "./constants.js";
import { getStaticThreeBufferGeometryAttributes } from "./utils/get-static-three-buffer-geometry-attributes.js";
import { getStaticThreeMaterialTextureProperties } from "./utils/get-static-three-material-texture-properties.js";
import { getStaticThreeMeshVisibility } from "./utils/get-static-three-mesh-visibility.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

export const threeRequireUvForTextureMap = defineRule({
  id: "three-require-uv-for-texture-map",
  title: "Mapped Three.js mesh geometry has no UVs",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Provide a uv, uv1, uv2, or uv3 BufferAttribute when a built-in mesh material samples a texture map",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (getThreeConstructorName(node, context.scopes) !== "Mesh") return;
      const geometry = node.arguments[THREE_MESH_GEOMETRY_ARGUMENT_INDEX];
      const material = node.arguments[THREE_MESH_MATERIAL_ARGUMENT_INDEX];
      if (!geometry || !material) return;
      const materialName = getThreeConstructorName(material, context.scopes);
      if (!materialName || !UV_MAPPED_MATERIAL_CONSTRUCTOR_NAMES.has(materialName)) return;
      const attributes = getStaticThreeBufferGeometryAttributes(geometry, node, context);
      const textureProperties = getStaticThreeMaterialTextureProperties(material, node, context);
      if (
        !attributes?.isComplete ||
        !textureProperties?.isComplete ||
        !textureProperties.isVisible ||
        getStaticThreeMeshVisibility(node, context) !== true ||
        !attributes.attributeNames.has("position") ||
        textureProperties.propertyNames.size === 0 ||
        [...UV_ATTRIBUTE_NAMES].some((attributeName) =>
          attributes.attributeNames.has(attributeName),
        )
      ) {
        return;
      }
      context.report({
        node: geometry,
        message: `${materialName} samples ${[...textureProperties.propertyNames].join(", ")}, but this custom BufferGeometry defines positions without any UV attribute`,
      });
    },
  }),
});
