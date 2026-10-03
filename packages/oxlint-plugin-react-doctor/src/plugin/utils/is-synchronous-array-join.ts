import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../constants/thresholds.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isSynchronousArrayJoin = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    getStaticPropertyName(node.callee) !== "join"
  )
    return false;

  let receiver = stripParenExpression(node.callee.object);
  for (let depth = 0; depth < FUNCTION_RESOLUTION_MAX_DEPTH; depth++) {
    if (isNodeOfType(receiver, "ArrayExpression")) return true;
    if (isNodeOfType(receiver, "Identifier")) {
      const symbol = resolveConstIdentifierAlias(receiver, scopes);
      if (!symbol?.initializer || symbol.references.some((reference) => reference.flag !== "read"))
        return false;
      receiver = stripParenExpression(symbol.initializer);
      continue;
    }
    if (!isNodeOfType(receiver, "CallExpression")) return false;
    const callee = stripParenExpression(receiver.callee);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      ["map", "filter", "slice"].includes(getStaticPropertyName(callee) ?? "")
    ) {
      receiver = stripParenExpression(callee.object);
      continue;
    }
    const target = resolveExactLocalFunction(callee, scopes);
    return Boolean(
      isFunctionLike(target) &&
      !target.async &&
      isNodeOfType(target.returnType, "TSTypeAnnotation") &&
      isNodeOfType(target.returnType.typeAnnotation, "TSArrayType"),
    );
  }
  return false;
};
