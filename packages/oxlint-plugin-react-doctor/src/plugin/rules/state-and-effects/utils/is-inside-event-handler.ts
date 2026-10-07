import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { isEventHandlerAttribute } from "../../../utils/is-event-handler-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const isInsideEventHandler = (
  node: EsTreeNode,
  handlerBindingNames: Set<string>,
): boolean => {
  let functionOwner = findEnclosingFunction(node)?.parent;
  while (functionOwner) {
    if (isEventHandlerAttribute(functionOwner)) return true;
    if (isNodeOfType(functionOwner, "VariableDeclarator")) {
      return (
        isNodeOfType(functionOwner.id, "Identifier") &&
        handlerBindingNames.has(functionOwner.id.name)
      );
    }
    if (isNodeOfType(functionOwner, "Program")) return false;
    functionOwner = functionOwner.parent;
  }
  return false;
};
