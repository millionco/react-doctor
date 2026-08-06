import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isEventHandlerAttribute } from "../../../utils/is-event-handler-attribute.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const collectHandlerBindingNames = (componentBody: EsTreeNode): Set<string> => {
  const handlerNames = new Set<string>();
  walkAst(componentBody, (child: EsTreeNode) => {
    if (!isEventHandlerAttribute(child)) return;
    if (!isNodeOfType(child.value, "JSXExpressionContainer")) return;
    const expression = child.value.expression;
    if (isNodeOfType(expression, "Identifier")) handlerNames.add(expression.name);
  });
  return handlerNames;
};
