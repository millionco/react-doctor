import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { isThreeModuleSource } from "./is-three-module-source.js";

interface ExplicitTextureColorSpaceAssignment {
  readonly colorSpaceName: "NoColorSpace" | "SRGBColorSpace";
  readonly node: EsTreeNodeOfType<"AssignmentExpression">;
  readonly textureKey: string;
}

export const getExplicitTextureColorSpaceAssignment = (
  node: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): ExplicitTextureColorSpaceAssignment | null => {
  const target = stripParenExpression(node.left);
  if (
    node.operator !== "=" ||
    !isNodeOfType(target, "MemberExpression") ||
    getStaticPropertyName(target) !== "colorSpace"
  ) {
    return null;
  }
  const provenance = getApiReferenceProvenance(stripParenExpression(node.right), context.scopes);
  if (
    !provenance ||
    (provenance.apiName !== "NoColorSpace" && provenance.apiName !== "SRGBColorSpace") ||
    !isThreeModuleSource(provenance.moduleSource)
  ) {
    return null;
  }
  const textureKey = resolveExpressionKey(target.object, context);
  return textureKey ? { colorSpaceName: provenance.apiName, node, textureKey } : null;
};
