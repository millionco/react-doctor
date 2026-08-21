import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  BUFFER_ATTRIBUTE_ARRAY_ARGUMENT_INDEX,
  BUFFER_ATTRIBUTE_NORMALIZED_ARGUMENT_INDEX,
} from "./constants.js";
import { getJsxAttributeExpression } from "./utils/get-jsx-attribute-expression.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isFloatTypedArray } from "./utils/is-float-typed-array.js";

const R3F_FLOAT_BUFFER_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "float16BufferAttribute",
  "float32BufferAttribute",
]);

export const r3fNoNormalizedFloatBufferAttribute = defineRule({
  id: "r3f-no-normalized-float-buffer-attribute",
  title: "Ignored normalization on R3F float attribute",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Use normalized only with integer buffer data; floating-point attributes are already represented directly",
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
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        const argsExpression = getJsxAttributeExpression(node, "args");
        if (!argsExpression || !isNodeOfType(argsExpression, "ArrayExpression")) return;
        const normalizedExpression =
          argsExpression.elements[BUFFER_ATTRIBUTE_NORMALIZED_ARGUMENT_INDEX];
        const arrayExpression = argsExpression.elements[BUFFER_ATTRIBUTE_ARRAY_ARGUMENT_INDEX];
        if (
          !normalizedExpression ||
          isNodeOfType(normalizedExpression, "SpreadElement") ||
          readStaticBoolean(normalizedExpression) !== true ||
          (!R3F_FLOAT_BUFFER_ATTRIBUTE_NAMES.has(node.name.name) &&
            (node.name.name !== "bufferAttribute" ||
              !arrayExpression ||
              isNodeOfType(arrayExpression, "SpreadElement") ||
              !isFloatTypedArray(arrayExpression, context.scopes)))
        ) {
          return;
        }
        context.report({
          node: normalizedExpression,
          message:
            "BufferAttribute normalized only applies to integer data and has no effect on floating-point arrays",
        });
      },
    };
  },
});
