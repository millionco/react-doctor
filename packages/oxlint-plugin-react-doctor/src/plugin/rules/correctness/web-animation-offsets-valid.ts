import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenBrowserApiReceiver } from "../../utils/is-proven-browser-api-receiver.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "../design/utils/get-effective-style-property.js";

interface StaticAnimationOffset {
  readonly node: EsTreeNode;
  readonly value: number;
}

const getStaticNumericOffset = (node: EsTreeNode): number | null => {
  if (isNodeOfType(node, "Literal") && typeof node.value === "number") return node.value;
  if (
    isNodeOfType(node, "UnaryExpression") &&
    node.operator === "-" &&
    isNodeOfType(node.argument, "Literal") &&
    typeof node.argument.value === "number"
  ) {
    return -node.argument.value;
  }
  return null;
};

const getArrayFormOffsets = (
  keyframes: EsTreeNodeOfType<"ArrayExpression">,
): ReadonlyArray<StaticAnimationOffset> | null => {
  const offsets: StaticAnimationOffset[] = [];
  for (const keyframe of keyframes.elements) {
    if (!keyframe || !isNodeOfType(keyframe, "ObjectExpression")) return null;
    if (keyframe.properties.some((property) => !isNodeOfType(property, "Property"))) return null;
    const offsetProperty = getEffectiveStyleProperty(keyframe.properties, "offset");
    if (!offsetProperty) continue;
    if (isNodeOfType(offsetProperty.value, "Literal") && offsetProperty.value.value === null) {
      continue;
    }
    const offset = getStaticNumericOffset(offsetProperty.value);
    if (offset === null) return null;
    offsets.push({ node: offsetProperty.value, value: offset });
  }
  return offsets;
};

const getPropertyIndexedOffsets = (
  keyframes: EsTreeNodeOfType<"ObjectExpression">,
): ReadonlyArray<StaticAnimationOffset> | null => {
  if (keyframes.properties.some((property) => !isNodeOfType(property, "Property"))) return null;
  const offsetProperty = getEffectiveStyleProperty(keyframes.properties, "offset");
  if (!offsetProperty || !isNodeOfType(offsetProperty.value, "ArrayExpression")) return null;
  const offsets: StaticAnimationOffset[] = [];
  for (const offsetElement of offsetProperty.value.elements) {
    if (!offsetElement) continue;
    if (isNodeOfType(offsetElement, "Literal") && offsetElement.value === null) continue;
    const offset = getStaticNumericOffset(offsetElement);
    if (offset === null) return null;
    offsets.push({ node: offsetElement, value: offset });
  }
  return offsets;
};

const getStaticAnimationOffsets = (
  keyframes: EsTreeNode,
): ReadonlyArray<StaticAnimationOffset> | null => {
  if (isNodeOfType(keyframes, "ArrayExpression")) return getArrayFormOffsets(keyframes);
  if (isNodeOfType(keyframes, "ObjectExpression")) return getPropertyIndexedOffsets(keyframes);
  return null;
};

const reportInvalidOffsets = (
  offsets: ReadonlyArray<StaticAnimationOffset>,
  context: RuleContext,
): void => {
  let previousOffset: number | null = null;
  for (const offset of offsets) {
    if (offset.value < 0 || offset.value > 1) {
      context.report({
        node: offset.node,
        message: `This Web Animation offset is ${offset.value}, but offsets must be between 0 and 1.`,
      });
      previousOffset = null;
      continue;
    }
    if (previousOffset !== null && offset.value < previousOffset) {
      context.report({
        node: offset.node,
        message: `This Web Animation offset moves backward from ${previousOffset} to ${offset.value}. Keep offsets in nondecreasing order.`,
      });
    }
    previousOffset = offset.value;
  }
};

export const webAnimationOffsetsValid = defineRule({
  id: "web-animation-offsets-valid",
  title: "Invalid Web Animation keyframe offsets",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Keep explicit Web Animation keyframe offsets between 0 and 1 and in nondecreasing order.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (getStaticPropertyName(node.callee) !== "animate") return;
      if (!isProvenBrowserApiReceiver(node.callee.object, "dom-event-target", context.scopes)) {
        return;
      }
      const keyframes = node.arguments[0];
      if (!keyframes) return;
      const offsets = getStaticAnimationOffsets(keyframes);
      if (!offsets) return;
      reportInvalidOffsets(offsets, context);
    },
  }),
});
