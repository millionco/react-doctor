import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { R3F_PUBLIC_MODULES } from "./r3f-public-modules.js";

export const isR3fCanvas = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const provenance = getApiReferenceProvenance(node.name, context.scopes);
  return Boolean(
    provenance &&
    provenance.apiName === "Canvas" &&
    R3F_PUBLIC_MODULES.has(provenance.moduleSource),
  );
};
