import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  BUFFER_ATTRIBUTE_ITEM_SIZE_ARGUMENT_INDEX,
  MINIMUM_BUFFER_ATTRIBUTE_ITEM_SIZE,
} from "./constants.js";
import { getJsxAttributeExpression } from "./utils/get-jsx-attribute-expression.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";

const R3F_BUFFER_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "bufferAttribute",
  "float16BufferAttribute",
  "float32BufferAttribute",
  "instancedBufferAttribute",
  "int16BufferAttribute",
  "int32BufferAttribute",
  "int8BufferAttribute",
  "uint16BufferAttribute",
  "uint32BufferAttribute",
  "uint8BufferAttribute",
  "uint8ClampedBufferAttribute",
]);

export const r3fValidBufferAttributeItemSize = defineRule({
  id: "r3f-valid-buffer-attribute-item-size",
  title: "Invalid R3F buffer attribute item size",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Use a positive integer itemSize matching the number of components per vertex attribute",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !isNodeOfType(node.name, "JSXIdentifier") ||
          !R3F_BUFFER_ATTRIBUTE_NAMES.has(node.name.name) ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        const argsExpression = getJsxAttributeExpression(node, "args");
        if (!argsExpression || !isNodeOfType(argsExpression, "ArrayExpression")) return;
        const itemSizeExpression =
          argsExpression.elements[BUFFER_ATTRIBUTE_ITEM_SIZE_ARGUMENT_INDEX];
        if (!itemSizeExpression || isNodeOfType(itemSizeExpression, "SpreadElement")) return;
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
    };
  },
});
