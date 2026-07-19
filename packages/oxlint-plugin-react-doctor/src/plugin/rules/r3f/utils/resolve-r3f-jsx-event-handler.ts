import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { isR3fHostIntrinsic } from "./is-r3f-host-intrinsic.js";
import { resolveLocalReactCallback } from "./resolve-local-react-callback.js";

export const resolveR3fJsxEventHandler = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  eventName: string,
  context: RuleContext,
): EsTreeNode | null => {
  if (!isR3fHostIntrinsic(node)) return null;
  const attribute = getAuthoritativeJsxAttribute(node.attributes, eventName);
  if (
    !attribute?.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
  ) {
    return null;
  }
  return resolveLocalReactCallback(attribute.value.expression, context.scopes);
};
