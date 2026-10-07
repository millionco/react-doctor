import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  BUFFER_ATTRIBUTE_ARRAY_ARGUMENT_INDEX,
  BUFFER_ATTRIBUTE_NORMALIZED_ARGUMENT_INDEX,
} from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { isFloatTypedArray } from "./utils/is-float-typed-array.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

const THREE_FLOAT_BUFFER_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "Float16BufferAttribute",
  "Float32BufferAttribute",
]);

const constructorUsesFloatData = (
  constructorName: string,
  arrayExpression: EsTreeNode | undefined,
  context: RuleContext,
): boolean =>
  THREE_FLOAT_BUFFER_ATTRIBUTE_NAMES.has(constructorName) ||
  Boolean(
    constructorName === "BufferAttribute" &&
    arrayExpression &&
    !isNodeOfType(arrayExpression, "SpreadElement") &&
    isFloatTypedArray(arrayExpression, context.scopes),
  );

export const threeNoNormalizedFloatBufferAttribute = defineRule({
  id: "three-no-normalized-float-buffer-attribute",
  title: "Ignored normalization on Three.js float attribute",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Use normalized only with integer buffer data; floating-point attributes are already represented directly",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      const normalizedExpression = node.arguments[BUFFER_ATTRIBUTE_NORMALIZED_ARGUMENT_INDEX];
      if (
        !provenance ||
        !isThreeModuleSource(provenance.moduleSource) ||
        !normalizedExpression ||
        isNodeOfType(normalizedExpression, "SpreadElement") ||
        readStaticBoolean(normalizedExpression) !== true ||
        !constructorUsesFloatData(
          provenance.apiName,
          node.arguments[BUFFER_ATTRIBUTE_ARRAY_ARGUMENT_INDEX],
          context,
        )
      ) {
        return;
      }
      context.report({
        node: normalizedExpression,
        message:
          "BufferAttribute normalized only applies to integer data and has no effect on floating-point arrays",
      });
    },
  }),
});
