import type { EsTreeNode } from "./es-tree-node.js";
import { isCookiesCall } from "./is-cookies-call.js";
import { isNodeOfType } from "./is-node-of-type.js";

// `cookies()` became async in Next.js 15, so users now write
// `await cookies()` directly OR `const store = await cookies(); …`.
// We unwrap one `await` so both the sync `cookies()` form and the
// async `await cookies()` form collapse to the same detection.
export const isCookiesOrAwaitedCookiesCall = (node: EsTreeNode): boolean => {
  if (isCookiesCall(node)) return true;
  if (isNodeOfType(node, "AwaitExpression") && node.argument) {
    return isCookiesCall(node.argument);
  }
  return false;
};
