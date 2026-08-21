import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const SHADER_CONFIGURATION_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "defines",
  "extensions",
  "fragmentShader",
  "glslVersion",
  "uniforms",
  "vertexShader",
]);

export const getShaderConfigurationMutationReceiver = (
  node: EsTreeNodeOfType<"AssignmentExpression">,
): EsTreeNode | null => {
  const target = stripParenExpression(node.left);
  if (!isNodeOfType(target, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(target);
  if (propertyName && SHADER_CONFIGURATION_PROPERTY_NAMES.has(propertyName)) {
    return target.object;
  }
  const parentMember = stripParenExpression(target.object);
  return isNodeOfType(parentMember, "MemberExpression") &&
    getStaticPropertyName(parentMember) === "defines"
    ? parentMember.object
    : null;
};
