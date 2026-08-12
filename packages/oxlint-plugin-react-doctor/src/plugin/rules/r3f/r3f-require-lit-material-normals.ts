import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { LIT_MATERIAL_CONSTRUCTOR_NAMES } from "./constants.js";
import { getActiveR3fMaterialTexturePropertyNames } from "./utils/get-active-r3f-material-texture-property-names.js";
import { getClosedR3fBufferGeometryAttributes } from "./utils/get-closed-r3f-buffer-geometry-attributes.js";
import { getR3fConstructorName } from "./utils/get-r3f-constructor-name.js";
import { getR3fSurfaceVisibility } from "./utils/get-r3f-surface-visibility.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";

export const r3fRequireLitMaterialNormals = defineRule({
  id: "r3f-require-lit-material-normals",
  title: "Normal-mapped R3F geometry has no normals",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Attach a normal BufferAttribute or compute vertex normals before applying a normal map to custom geometry",
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
        const materialChildren = elementChildren.filter((child) => {
          const elementType = resolveJsxElementType(child.openingElement);
          const materialConstructorName = elementType ? getR3fConstructorName(elementType) : null;
          return Boolean(
            materialConstructorName &&
            LIT_MATERIAL_CONSTRUCTOR_NAMES.has(materialConstructorName) &&
            !child.openingElement.attributes.some((attribute) =>
              isNodeOfType(attribute, "JSXSpreadAttribute"),
            ) &&
            getActiveR3fMaterialTexturePropertyNames(
              child.openingElement,
              materialConstructorName,
            ).has("normalMap") &&
            !getAuthoritativeJsxAttribute(child.openingElement.attributes, "attach"),
          );
        });
        if (geometryChildren.length !== 1 || materialChildren.length !== 1) return;
        const hasUnknownChild = elementChildren.some(
          (child) => child !== geometryChildren[0] && child !== materialChildren[0],
        );
        if (hasUnknownChild) return;
        const geometry = geometryChildren[0];
        if (!geometry || !isR3fHostIntrinsic(geometry.openingElement)) return;
        const attributes = getClosedR3fBufferGeometryAttributes(geometry, context.scopes);
        if (
          !attributes.isComplete ||
          !attributes.attributeNames.has("position") ||
          attributes.attributeNames.has("normal")
        ) {
          return;
        }
        const materialType = resolveJsxElementType(materialChildren[0]?.openingElement);
        const material = materialChildren[0];
        if (!material || getR3fSurfaceVisibility(node, material.openingElement, context) !== true) {
          return;
        }
        context.report({
          node: geometry.openingElement,
          message: `${materialType ?? "This lit material"} applies a normalMap to this custom bufferGeometry, but the geometry defines positions without the normals needed to establish its normal basis`,
        });
      },
    };
  },
});
