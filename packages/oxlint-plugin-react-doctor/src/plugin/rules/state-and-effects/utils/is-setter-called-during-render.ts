import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";

// True when `setterName` is invoked synchronously in the render phase of
// `root` (the component function or its body block) — i.e. NOT inside a
// nested handler, effect, memo, or other callback. Calling a state setter
// during render is the signature of React's "adjust state while rendering"
// / "store information from previous renders" pattern
// (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
// where state is intentionally re-synced during render rather than in an
// effect. That value is neither write-only nor a stale prop copy, so rules
// that assume otherwise must bail.
export const isSetterCalledDuringRender = (root: EsTreeNode, setterName: string): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (found) return false;
    if (child !== root && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === setterName
    ) {
      found = true;
      return false;
    }
  });
  return found;
};
