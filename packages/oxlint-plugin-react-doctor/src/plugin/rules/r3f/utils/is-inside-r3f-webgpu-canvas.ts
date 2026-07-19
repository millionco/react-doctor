import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { getApiReferenceModuleSource } from "./get-api-reference-module-source.js";
import { R3F_PUBLIC_MODULES } from "./r3f-public-modules.js";
import { R3F_WEBGPU_MODULES } from "./r3f-webgpu-modules.js";

export const isInsideR3fWebgpuCanvas = (node: EsTreeNode, context: RuleContext): boolean => {
  let current = node.parent ?? null;
  while (current) {
    if (isNodeOfType(current, "JSXElement")) {
      const moduleSource = getApiReferenceModuleSource(
        current.openingElement.name,
        "Canvas",
        context.scopes,
      );
      if (moduleSource && R3F_PUBLIC_MODULES.has(moduleSource)) {
        return R3F_WEBGPU_MODULES.has(moduleSource);
      }
    }
    current = current.parent ?? null;
  }
  return false;
};
