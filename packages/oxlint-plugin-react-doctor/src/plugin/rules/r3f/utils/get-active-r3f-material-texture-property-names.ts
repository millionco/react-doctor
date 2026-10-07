import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { isNullishExpression } from "../../../utils/is-nullish-expression.js";
import { UV_TEXTURE_PROPERTY_NAMES_BY_MATERIAL } from "../constants.js";
import { getJsxAttributeExpression } from "./get-jsx-attribute-expression.js";

export const getActiveR3fMaterialTexturePropertyNames = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  materialConstructorName: string,
): ReadonlySet<string> =>
  new Set(
    [...(UV_TEXTURE_PROPERTY_NAMES_BY_MATERIAL.get(materialConstructorName) ?? [])].filter(
      (propertyName) => {
        const attribute = getAuthoritativeJsxAttribute(node.attributes, propertyName);
        if (!attribute) return false;
        const expression = getJsxAttributeExpression(node, propertyName);
        return (
          expression === null || (expression !== undefined && !isNullishExpression(expression))
        );
      },
    ),
  );
