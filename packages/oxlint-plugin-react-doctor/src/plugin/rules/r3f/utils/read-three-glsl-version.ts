import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { isThreeModuleSource } from "./is-three-module-source.js";

export const readThreeGlslVersion = (
  expression: EsTreeNode | undefined,
  context: RuleContext,
): "glsl1" | "glsl3" | null => {
  if (!expression) return "glsl1";
  if (isNodeOfType(expression, "Literal")) {
    if (expression.value === "300 es") return "glsl3";
    if (expression.value === "100") return "glsl1";
    return null;
  }
  const provenance = getApiReferenceProvenance(expression, context.scopes);
  if (!provenance || !isThreeModuleSource(provenance.moduleSource)) return null;
  if (provenance.apiName === "GLSL3") return "glsl3";
  return provenance.apiName === "GLSL1" ? "glsl1" : null;
};
