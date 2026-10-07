import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticArrayLikeLength } from "../../utils/get-static-array-like-length.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  BUFFER_ATTRIBUTE_ARRAY_ARGUMENT_INDEX,
  BUFFER_ATTRIBUTE_ITEM_SIZE_ARGUMENT_INDEX,
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

export const r3fValidBufferAttributeArrayLength = defineRule({
  id: "r3f-valid-buffer-attribute-array-length",
  title: "R3F buffer attribute has a partial final item",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation: "Use an attribute array length divisible by itemSize",
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
        const arrayExpression = argsExpression.elements[BUFFER_ATTRIBUTE_ARRAY_ARGUMENT_INDEX];
        const itemSizeExpression =
          argsExpression.elements[BUFFER_ATTRIBUTE_ITEM_SIZE_ARGUMENT_INDEX];
        if (
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
          message: `R3F BufferAttribute array length ${arrayLength} is not divisible by itemSize ${itemSize}, so the final attribute item is incomplete`,
        });
      },
    };
  },
});
