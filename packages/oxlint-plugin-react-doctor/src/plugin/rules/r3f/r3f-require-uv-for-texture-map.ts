import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { UV_ATTRIBUTE_NAMES, UV_MAPPED_MATERIAL_CONSTRUCTOR_NAMES } from "./constants.js";
import { getActiveR3fMaterialTexturePropertyNames } from "./utils/get-active-r3f-material-texture-property-names.js";
import { getClosedR3fBufferGeometryAttributes } from "./utils/get-closed-r3f-buffer-geometry-attributes.js";
import { getR3fConstructorName } from "./utils/get-r3f-constructor-name.js";
import { getR3fSurfaceVisibility } from "./utils/get-r3f-surface-visibility.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";

export const r3fRequireUvForTextureMap = defineRule({
  id: "r3f-require-uv-for-texture-map",
  title: "Mapped R3F mesh geometry has no UVs",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Attach a uv, uv1, uv2, or uv3 BufferAttribute when a built-in mesh material samples a texture map",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        const mesh = node.openingElement;
        if (
          !importsReactThreeFiber ||
          resolveJsxElementType(mesh) !== "mesh" ||
          !isR3fHostIntrinsic(mesh) ||
          mesh.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")) ||
          getAuthoritativeJsxAttribute(mesh.attributes, "geometry") ||
          getAuthoritativeJsxAttribute(mesh.attributes, "material")
        ) {
          return;
        }
        const elementChildren = node.children.filter((child) => isNodeOfType(child, "JSXElement"));
        const geometryChildren = elementChildren.filter(
          (child) => resolveJsxElementType(child.openingElement) === "bufferGeometry",
        );
        const mappedMaterialChildren = elementChildren.filter((child) => {
          const elementType = resolveJsxElementType(child.openingElement);
          return Boolean(
            elementType &&
            UV_MAPPED_MATERIAL_CONSTRUCTOR_NAMES.has(getR3fConstructorName(elementType)) &&
            !child.openingElement.attributes.some((attribute) =>
              isNodeOfType(attribute, "JSXSpreadAttribute"),
            ) &&
            getActiveR3fMaterialTexturePropertyNames(
              child.openingElement,
              getR3fConstructorName(elementType),
            ).size > 0 &&
            !getAuthoritativeJsxAttribute(child.openingElement.attributes, "attach"),
          );
        });
        if (geometryChildren.length !== 1 || mappedMaterialChildren.length !== 1) return;
        const hasUnknownChild = elementChildren.some(
          (child) => child !== geometryChildren[0] && child !== mappedMaterialChildren[0],
        );
        if (hasUnknownChild) return;
        const geometry = geometryChildren[0];
        const material = mappedMaterialChildren[0];
        if (
          !geometry ||
          !material ||
          !isR3fHostIntrinsic(geometry.openingElement) ||
          !isR3fHostIntrinsic(material.openingElement)
        ) {
          return;
        }
        const attributes = getClosedR3fBufferGeometryAttributes(geometry, context.scopes);
        if (
          !attributes.isComplete ||
          !attributes.attributeNames.has("position") ||
          [...UV_ATTRIBUTE_NAMES].some((attributeName) =>
            attributes.attributeNames.has(attributeName),
          )
        ) {
          return;
        }
        const materialType = resolveJsxElementType(material.openingElement);
        if (!materialType) return;
        if (getR3fSurfaceVisibility(node, material.openingElement, context) !== true) return;
        const texturePropertyNames = getActiveR3fMaterialTexturePropertyNames(
          material.openingElement,
          getR3fConstructorName(materialType),
        );
        context.report({
          node: geometry.openingElement,
          message: `${resolveJsxElementType(material.openingElement) ?? "This material"} samples ${[...texturePropertyNames].join(", ")}, but this custom bufferGeometry defines positions without any UV attribute`,
        });
      },
    };
  },
});
