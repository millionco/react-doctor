import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../../utils/is-nullish-expression.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { PBR_MATERIAL_CONSTRUCTOR_NAMES, THREE_LIGHT_CONSTRUCTOR_NAMES } from "../constants.js";
import { DREI_PUBLIC_MODULES } from "./drei-public-modules.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { getJsxAttributeExpression } from "./get-jsx-attribute-expression.js";
import { getR3fConstructorName } from "./get-r3f-constructor-name.js";
import { getR3fSurfaceVisibility } from "./get-r3f-surface-visibility.js";
import { getStaticNumber } from "./get-static-number.js";
import { isR3fHostIntrinsic } from "./is-r3f-host-intrinsic.js";

export interface ClosedR3fPbrMaterialFact {
  constructorName: string;
  hasEmissiveSource: boolean;
  hasEnvironmentMap: boolean;
  hasLightMap: boolean;
  metalness: number | null;
  node: EsTreeNodeOfType<"JSXOpeningElement">;
}

export interface ClosedR3fCanvasLighting {
  hasEnvironment: boolean;
  hasLight: boolean;
  isComplete: boolean;
  materials: ReadonlyArray<ClosedR3fPbrMaterialFact>;
}

const hasAttribute = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): boolean => Boolean(getAuthoritativeJsxAttribute(node.attributes, attributeName));

const hasNonNullishAttribute = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): boolean => {
  const attribute = getAuthoritativeJsxAttribute(node.attributes, attributeName);
  if (!attribute) return false;
  const expression = getJsxAttributeExpression(node, attributeName);
  return expression === null || (expression !== undefined && !isNullishExpression(expression));
};

const isDefaultMeshMaterial = (
  material: EsTreeNodeOfType<"JSXElement">,
  parent: EsTreeNodeOfType<"JSXElement"> | null,
): boolean => {
  if (!parent || resolveJsxElementType(parent.openingElement) !== "mesh") return false;
  if (
    parent.openingElement.attributes.some((attribute) =>
      isNodeOfType(attribute, "JSXSpreadAttribute"),
    ) ||
    hasAttribute(parent.openingElement, "material") ||
    hasAttribute(material.openingElement, "attach")
  ) {
    return false;
  }
  const materialChildren = parent.children.filter(
    (child) =>
      isNodeOfType(child, "JSXElement") &&
      resolveJsxElementType(child.openingElement)?.endsWith("Material"),
  );
  return materialChildren.length === 1 && materialChildren[0] === material;
};

export const analyzeClosedR3fCanvasLighting = (
  canvas: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): ClosedR3fCanvasLighting => {
  const analysis: {
    hasEnvironment: boolean;
    hasLight: boolean;
    isComplete: boolean;
    materials: ClosedR3fPbrMaterialFact[];
  } = {
    hasEnvironment: false,
    hasLight: false,
    isComplete: true,
    materials: [],
  };
  const visitChildren = (
    children: ReadonlyArray<EsTreeNode>,
    parent: EsTreeNodeOfType<"JSXElement"> | null,
    isVisible: boolean,
  ): void => {
    for (const child of children) {
      if (isNodeOfType(child, "JSXText") && child.value.trim() === "") continue;
      if (isNodeOfType(child, "JSXExpressionContainer")) {
        if (!isNodeOfType(child.expression, "JSXEmptyExpression")) analysis.isComplete = false;
        continue;
      }
      if (isNodeOfType(child, "JSXFragment")) {
        visitChildren(child.children, parent, isVisible);
        continue;
      }
      if (!isNodeOfType(child, "JSXElement")) {
        analysis.isComplete = false;
        continue;
      }
      const openingElement = child.openingElement;
      const visibleExpression = getJsxAttributeExpression(openingElement, "visible");
      const childIsVisible =
        isVisible &&
        !(
          visibleExpression &&
          isNodeOfType(visibleExpression, "Literal") &&
          visibleExpression.value === false
        );
      const provenance = getApiReferenceProvenance(openingElement.name, context.scopes);
      if (
        provenance?.apiName === "Environment" &&
        DREI_PUBLIC_MODULES.has(provenance.moduleSource)
      ) {
        analysis.hasEnvironment = true;
        continue;
      }
      if (!isR3fHostIntrinsic(openingElement)) {
        analysis.isComplete = false;
        continue;
      }
      const elementType = resolveJsxElementType(openingElement);
      if (!elementType || elementType === "primitive") {
        analysis.isComplete = false;
        continue;
      }
      const constructorName = getR3fConstructorName(elementType);
      const intensityExpression = getJsxAttributeExpression(openingElement, "intensity");
      const intensity = intensityExpression
        ? getStaticNumber(intensityExpression, context.scopes)
        : null;
      if (
        childIsVisible &&
        THREE_LIGHT_CONSTRUCTOR_NAMES.has(constructorName) &&
        (intensity === null || intensity > 0)
      ) {
        analysis.hasLight = true;
      }
      if (
        childIsVisible &&
        PBR_MATERIAL_CONSTRUCTOR_NAMES.has(constructorName) &&
        isDefaultMeshMaterial(child, parent)
      ) {
        const surfaceVisibility = parent
          ? getR3fSurfaceVisibility(parent, openingElement, context)
          : null;
        if (surfaceVisibility === null) {
          analysis.isComplete = false;
          visitChildren(child.children, child, childIsVisible);
          continue;
        }
        if (!surfaceVisibility) {
          visitChildren(child.children, child, childIsVisible);
          continue;
        }
        if (
          openingElement.attributes.some((attribute) =>
            isNodeOfType(attribute, "JSXSpreadAttribute"),
          )
        ) {
          analysis.isComplete = false;
        } else {
          const metalnessExpression = getJsxAttributeExpression(openingElement, "metalness");
          analysis.materials.push({
            constructorName,
            hasEmissiveSource:
              hasNonNullishAttribute(openingElement, "emissive") ||
              hasNonNullishAttribute(openingElement, "emissiveNode"),
            hasEnvironmentMap:
              hasNonNullishAttribute(openingElement, "envMap") ||
              hasNonNullishAttribute(openingElement, "envNode"),
            hasLightMap: hasNonNullishAttribute(openingElement, "lightMap"),
            metalness: metalnessExpression
              ? getStaticNumber(metalnessExpression, context.scopes)
              : null,
            node: openingElement,
          });
        }
      }
      visitChildren(child.children, child, childIsVisible);
    }
  };
  const canvasOpeningElement = canvas.openingElement;
  if (
    canvasOpeningElement.attributes.some((attribute) =>
      isNodeOfType(attribute, "JSXSpreadAttribute"),
    ) ||
    hasAttribute(canvasOpeningElement, "onCreated") ||
    hasAttribute(canvasOpeningElement, "scene")
  ) {
    analysis.isComplete = false;
  }
  visitChildren(canvas.children, null, true);
  return analysis;
};
