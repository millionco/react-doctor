import { isUseSelectorIdentifier } from "../../../utils/collect-react-redux-selector-aliases.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

// Returns the inline selector function passed to a `useSelector(...)`
// call — or a same-file typed-wrapper alias such as `useAppSelector` —
// when it's a plain arrow / function expression and no second equality
// argument is present. Null otherwise.
//
// This is the shared entry guard for both `redux-useselector-*` rules:
// neither fires on a hoisted selector reference (those usually pair
// with a memoised `createSelector`) or on a call that already supplies
// `shallowEqual` / a custom equality fn.
export const inlineUseSelectorFunction = (
  callNode: EsTreeNodeOfType<"CallExpression">,
  aliases: ReadonlySet<string>,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression"> | null => {
  if (!isUseSelectorIdentifier(callNode.callee as EsTreeNode, aliases)) return null;
  const args = callNode.arguments ?? [];
  if (args.length === 0 || args.length >= 2) return null;
  const selectorArgument = stripParenExpression(args[0]);
  if (
    isNodeOfType(selectorArgument, "ArrowFunctionExpression") ||
    isNodeOfType(selectorArgument, "FunctionExpression")
  ) {
    return selectorArgument;
  }
  return null;
};
