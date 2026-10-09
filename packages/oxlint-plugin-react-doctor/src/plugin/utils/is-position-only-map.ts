import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasOnlyJsxKeyIndexReads } from "./has-only-jsx-key-index-reads.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isPositionOnlyMap = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(call.callee, "MemberExpression") ||
    getStaticPropertyName(call.callee) !== "map"
  )
    return false;
  const callback = call.arguments[0];
  if (
    !callback ||
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    !hasOnlyJsxKeyIndexReads(callback)
  )
    return false;
  const item = callback.params[0];
  const collection = callback.params[2];
  if (!isNodeOfType(item, "Identifier")) return false;
  if (scopes.symbolFor(item)?.references.length !== 0) return false;
  return (
    !collection ||
    (isNodeOfType(collection, "Identifier") &&
      scopes.symbolFor(collection)?.references.length === 0)
  );
};
