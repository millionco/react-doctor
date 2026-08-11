import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { GPU_LINE_WIDTH_PX } from "./constants.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getThreePropertyAssignment } from "./utils/get-three-property-assignment.js";
import { isThreeModuleSource } from "./utils/is-three-module-source.js";

const GPU_LINE_MATERIAL_NAMES: ReadonlySet<string> = new Set([
  "LineBasicMaterial",
  "LineDashedMaterial",
]);

const reportIgnoredLineWidth = (expression: EsTreeNode, context: RuleContext): void => {
  const value = getStaticNumber(expression, context.scopes);
  if (value === null || value === GPU_LINE_WIDTH_PX) return;
  context.report({
    node: expression,
    message: `linewidth ${String(value)} is ignored by Three.js WebGL and WebGPU renderers, which render line primitives one pixel wide`,
  });
};

export const threeNoIgnoredLinewidth = defineRule({
  id: "three-no-ignored-linewidth",
  title: "Three.js GPU renderer ignores line width",
  category: "Correctness",
  severity: "warn",
  recommendation: "Use Line2 for wide GPU-rendered lines, or leave linewidth at one pixel",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      const parameters = node.arguments[0];
      if (
        !provenance ||
        !GPU_LINE_MATERIAL_NAMES.has(provenance.apiName) ||
        !isThreeModuleSource(provenance.moduleSource) ||
        !parameters
      ) {
        return;
      }
      const expression = getStaticObjectPropertyValue(parameters, "linewidth");
      if (expression) reportIgnoredLineWidth(expression, context);
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      const assignment = getThreePropertyAssignment(node, context);
      if (
        !assignment ||
        !GPU_LINE_MATERIAL_NAMES.has(assignment.constructorName) ||
        assignment.propertyName !== "linewidth"
      ) {
        return;
      }
      reportIgnoredLineWidth(assignment.value, context);
    },
  }),
});
