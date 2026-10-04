import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getJsxPropStaticStringValues } from "../../../utils/get-jsx-prop-static-string-values.js";

const R3F_ATTRIBUTE_ATTACH_PREFIX = "attributes-";

export const getR3fBufferAttributeName = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): string | null => {
  const attachAttribute = getAuthoritativeJsxAttribute(node.attributes, "attach");
  if (!attachAttribute) return null;
  const attachValues = getJsxPropStaticStringValues(attachAttribute, scopes);
  if (!attachValues || attachValues.length === 0) return null;
  const attributeNames = new Set(
    attachValues.map((value) =>
      value.startsWith(R3F_ATTRIBUTE_ATTACH_PREFIX)
        ? value.slice(R3F_ATTRIBUTE_ATTACH_PREFIX.length)
        : null,
    ),
  );
  if (attributeNames.size !== 1 || attributeNames.has(null)) return null;
  return [...attributeNames][0] ?? null;
};
