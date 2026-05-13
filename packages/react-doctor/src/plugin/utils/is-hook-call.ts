import type { EsTreeNode } from "./es-tree-node.js";
import { getCalleeName } from "./get-callee-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isHookCall = (node: EsTreeNode, hookName: string | Set<string>): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const calleeName = getCalleeName(node);
  if (!calleeName) return false;
  return typeof hookName === "string" ? calleeName === hookName : hookName.has(calleeName);
};
