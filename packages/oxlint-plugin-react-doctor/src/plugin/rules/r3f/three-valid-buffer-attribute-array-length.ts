import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticArrayLikeLength } from "../../utils/get-static-array-like-length.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  BUFFER_ATTRIBUTE_ARRAY_ARGUMENT_INDEX,
  BUFFER_ATTRIBUTE_ITEM_SIZE_ARGUMENT_INDEX,
  THREE_BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES,
} from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

export const threeValidBufferAttributeArrayLength = defineRule({
  id: "three-valid-buffer-attribute-array-length",
  title: "Buffer attribute has a partial final item",
  category: "Correctness",
  severity: "error",
  recommendation: "Use an attribute array length divisible by itemSize",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      const arrayExpression = node.arguments[BUFFER_ATTRIBUTE_ARRAY_ARGUMENT_INDEX];
      const itemSizeExpression = node.arguments[BUFFER_ATTRIBUTE_ITEM_SIZE_ARGUMENT_INDEX];
      if (
        !provenance ||
        !THREE_BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES.has(provenance.apiName) ||
        !isThreeModuleSource(provenance.moduleSource) ||
        !arrayExpression ||
        isNodeOfType(arrayExpression, "SpreadElement") ||
        !itemSizeExpression ||
        isNodeOfType(itemSizeExpression, "SpreadElement")
      ) {
        return;
      }
      const arrayLength = getStaticArrayLikeLength(arrayExpression, context.scopes);
      const itemSize = getStaticNumber(itemSizeExpression, context.scopes);
      if (
        arrayLength === null ||
        itemSize === null ||
        !Number.isInteger(itemSize) ||
        itemSize <= 0 ||
        arrayLength % itemSize === 0
      ) {
        return;
      }
      context.report({
        node: arrayExpression,
        message: `BufferAttribute array length ${arrayLength} is not divisible by itemSize ${itemSize}, so the final attribute item is incomplete`,
      });
    },
  }),
});
