import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getJsxPropStaticStringValues } from "../../../utils/get-jsx-prop-static-string-values.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";

export const isR3fPositionBufferAttribute = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (resolveJsxElementType(node) !== "bufferAttribute") return false;
  const attachAttribute = getAuthoritativeJsxAttribute(node.attributes, "attach");
  if (!attachAttribute) return false;
  const attachValues = getJsxPropStaticStringValues(attachAttribute, scopes);
  return Boolean(
    attachValues &&
    attachValues.length > 0 &&
    attachValues.every((value) => value === "attributes-position"),
  );
};
