import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";

// True when any setter in `setterNames` is invoked synchronously in the own
// scope of `root` — i.e. NOT inside a nested handler, effect, memo, or other
// callback. With the component body as `root` this recognizes React's
// "adjust state while rendering" / "store information from previous renders"
// pattern (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes);
// with an effect callback as `root` it recognizes an effect whose body
// synchronously chains state updates.
export const callsSetterInOwnScope = (
  root: EsTreeNode,
  setterNames: ReadonlySet<string>,
): boolean => {
  let didFindSetterCall = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (didFindSetterCall) return false;
    if (child !== root && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      setterNames.has(child.callee.name)
    ) {
      didFindSetterCall = true;
      return false;
    }
  });
  return didFindSetterCall;
};
