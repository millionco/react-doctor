import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { NO_VALUE_COUNT, SINGLE_VALUE_COUNT } from "./callback-map-snapshot/constants.js";

export const isDiscardedCallbackMapFocusObservation = (current: EsTreeNode): boolean => {
  const getMember = current.parent;
  if (
    !getMember ||
    !isNodeOfType(getMember, "MemberExpression") ||
    getMember.object !== current ||
    getMember.computed ||
    getMember.optional ||
    !isNodeOfType(getMember.property, "Identifier") ||
    getMember.property.name !== "get"
  )
    return false;
  const getCall = getMember.parent;
  if (
    !getCall ||
    !isNodeOfType(getCall, "CallExpression") ||
    getCall.callee !== getMember ||
    getCall.optional ||
    getCall.arguments.length !== SINGLE_VALUE_COUNT ||
    isNodeOfType(getCall.arguments[NO_VALUE_COUNT], "SpreadElement")
  )
    return false;
  const focusMember = getCall.parent;
  if (
    !focusMember ||
    !isNodeOfType(focusMember, "MemberExpression") ||
    focusMember.object !== getCall ||
    focusMember.computed ||
    !isNodeOfType(focusMember.property, "Identifier") ||
    focusMember.property.name !== "focus"
  )
    return false;
  const focusCall = focusMember.parent;
  if (
    !focusCall ||
    !isNodeOfType(focusCall, "CallExpression") ||
    focusCall.callee !== focusMember ||
    focusCall.arguments.length !== NO_VALUE_COUNT
  )
    return false;
  return isNodeOfType(findTransparentExpressionRoot(focusCall).parent, "ExpressionStatement");
};
