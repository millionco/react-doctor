import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getApiReferenceModuleSource } from "./utils/get-api-reference-module-source.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const HIGH_PRECISION_INCOMPATIBLE_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  "instancedMesh",
  "skinnedMesh",
]);

const canvasFactoryEnablesHighPrecision = (
  canvas: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  const glAttribute = getAuthoritativeJsxAttribute(canvas.openingElement.attributes, "gl");
  if (
    !glAttribute?.value ||
    !isNodeOfType(glAttribute.value, "JSXExpressionContainer") ||
    isNodeOfType(glAttribute.value.expression, "JSXEmptyExpression")
  ) {
    return false;
  }
  const factory = resolveLocalReactCallback(glAttribute.value.expression, context.scopes);
  if (!factory) return false;
  let enablesHighPrecision = false;
  walkFunctionExecution(factory, context.scopes, (candidate) => {
    if (enablesHighPrecision || !isNodeOfType(candidate, "AssignmentExpression")) return;
    const target = candidate.left;
    enablesHighPrecision = Boolean(
      candidate.operator === "=" &&
      readStaticBoolean(candidate.right) === true &&
      isNodeOfType(target, "MemberExpression") &&
      getStaticPropertyName(target) === "highPrecision" &&
      getThreeConstructorName(target.object, context.scopes) === "WebGPURenderer",
    );
  });
  return enablesHighPrecision;
};

const findOwningCanvas = (
  node: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"JSXElement"> | null => {
  let current = node.parent ?? null;
  while (current) {
    if (
      isNodeOfType(current, "JSXElement") &&
      getApiReferenceModuleSource(current.openingElement.name, "Canvas", context.scopes) ===
        "@react-three/fiber"
    ) {
      return current;
    }
    current = current.parent ?? null;
  }
  return null;
};

export const r3fWebgpuNoHighPrecisionInstancing = defineRule({
  id: "r3f-webgpu-no-high-precision-instancing",
  title: "R3F WebGPU high precision conflicts with instanced meshes",
  category: "Correctness",
  tags: ["react-jsx-only"],
  requires: ["three:181"],
  severity: "error",
  recommendation:
    "Disable renderer.highPrecision for Canvas trees containing instancedMesh or skinnedMesh",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isR3fHostIntrinsic(node) ||
        !HIGH_PRECISION_INCOMPATIBLE_ELEMENT_TYPES.has(resolveJsxElementType(node) ?? "")
      ) {
        return;
      }
      const canvas = findOwningCanvas(node, context);
      if (!canvas || !canvasFactoryEnablesHighPrecision(canvas, context)) return;
      context.report({
        node,
        message:
          "This R3F object is rendered by a WebGPURenderer with highPrecision enabled, but Three.js does not support 64-bit matrices for InstancedMesh or SkinnedMesh",
      });
    },
  }),
});
