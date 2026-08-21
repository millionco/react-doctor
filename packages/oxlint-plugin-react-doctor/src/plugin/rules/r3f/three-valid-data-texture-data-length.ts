import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticArrayLikeLength } from "../../utils/get-static-array-like-length.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  DATA_TEXTURE_FORMAT_COMPONENT_COUNT_BY_NAME,
  DATA_TEXTURE_TYPE_ARGUMENT_INDEX,
  DATA_TEXTURE_UNPACKED_TYPE_NAMES,
  DATA_VOLUME_TEXTURE_TYPE_ARGUMENT_INDEX,
  DEFAULT_DATA_TEXTURE_DIMENSION_PX,
} from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getDataTextureConstructorShape } from "./utils/get-data-texture-constructor-shape.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

const getThreeApiName = (expression: EsTreeNode, context: RuleContext): string | null => {
  const provenance = getApiReferenceProvenance(expression, context.scopes);
  return provenance && isThreeModuleSource(provenance.moduleSource) ? provenance.apiName : null;
};

const getDimension = (expression: EsTreeNode | null, context: RuleContext): number | null =>
  expression ? getStaticNumber(expression, context.scopes) : DEFAULT_DATA_TEXTURE_DIMENSION_PX;

export const threeValidDataTextureDataLength = defineRule({
  id: "three-valid-data-texture-data-length",
  title: "Data texture storage is too short",
  category: "Correctness",
  severity: "error",
  recommendation: "Allocate enough typed-array elements for every data-texture texel component",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const texture = getDataTextureConstructorShape(node, context);
      if (
        !texture?.data ||
        (isNodeOfType(texture.data, "Literal") && texture.data.value === null)
      ) {
        return;
      }
      const dataLength = getStaticArrayLikeLength(texture.data, context.scopes);
      const width = getDimension(texture.width, context);
      const height = getDimension(texture.height, context);
      const depth = getDimension(texture.depth, context);
      if (
        dataLength === null ||
        width === null ||
        height === null ||
        depth === null ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        !Number.isInteger(depth) ||
        width <= 0 ||
        height <= 0 ||
        depth <= 0
      ) {
        return;
      }
      const formatName = texture.format ? getThreeApiName(texture.format, context) : "RGBAFormat";
      const componentCount = formatName
        ? DATA_TEXTURE_FORMAT_COMPONENT_COUNT_BY_NAME.get(formatName)
        : undefined;
      const typeArgumentIndex = texture.depth
        ? DATA_VOLUME_TEXTURE_TYPE_ARGUMENT_INDEX
        : DATA_TEXTURE_TYPE_ARGUMENT_INDEX;
      const typeArgument = node.arguments[typeArgumentIndex];
      if (
        !componentCount ||
        (typeArgument &&
          (isNodeOfType(typeArgument, "SpreadElement") ||
            !DATA_TEXTURE_UNPACKED_TYPE_NAMES.has(getThreeApiName(typeArgument, context) ?? "")))
      ) {
        return;
      }
      const requiredLength = width * height * depth * componentCount;
      if (dataLength >= requiredLength) return;
      context.report({
        node: texture.data,
        message: `This data texture needs at least ${requiredLength} array elements for ${width} × ${height} × ${depth} texels in ${formatName}, but the static buffer has ${dataLength}`,
      });
    },
  }),
});
