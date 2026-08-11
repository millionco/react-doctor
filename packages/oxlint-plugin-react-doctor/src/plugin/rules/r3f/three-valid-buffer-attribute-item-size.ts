import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  BUFFER_ATTRIBUTE_ITEM_SIZE_ARGUMENT_INDEX,
  MINIMUM_BUFFER_ATTRIBUTE_ITEM_SIZE,
  THREE_BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES,
} from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

export const threeValidBufferAttributeItemSize = defineRule({
  id: "three-valid-buffer-attribute-item-size",
  title: "Invalid Three.js buffer attribute item size",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Use a positive integer itemSize matching the number of components per vertex attribute",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      const itemSizeExpression = node.arguments[BUFFER_ATTRIBUTE_ITEM_SIZE_ARGUMENT_INDEX];
      if (
        !provenance ||
        !THREE_BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES.has(provenance.apiName) ||
        !isThreeModuleSource(provenance.moduleSource) ||
        !itemSizeExpression ||
        isNodeOfType(itemSizeExpression, "SpreadElement")
      ) {
        return;
      }
      const itemSize = getStaticNumber(itemSizeExpression, context.scopes);
      if (
        itemSize === null ||
        (Number.isInteger(itemSize) && itemSize >= MINIMUM_BUFFER_ATTRIBUTE_ITEM_SIZE)
      ) {
        return;
      }
      context.report({
        node: itemSizeExpression,
        message: `BufferAttribute itemSize ${String(itemSize)} is invalid; itemSize must be a positive integer`,
      });
    },
  }),
});
