import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isReactForwardedRefParameter = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = resolveConstIdentifierAlias(stripParenExpression(expression), scopes);
  if (
    !symbol ||
    symbol.kind !== "parameter" ||
    symbol.references.some(
      (reference) =>
        reference.flag !== "read" ||
        (!isNodeOfType(
          findTransparentExpressionRoot(reference.identifier).parent,
          "MemberExpression",
        ) &&
          isWithinAssignmentTarget(reference.identifier)),
    )
  ) {
    return false;
  }
  const renderFunction = symbol.scope.node;
  if (!isFunctionLike(renderFunction) || renderFunction.params[1] !== symbol.bindingIdentifier) {
    return false;
  }
  const renderArgument = findTransparentExpressionRoot(renderFunction);
  const wrapperCall = renderArgument.parent;
  return Boolean(
    isNodeOfType(wrapperCall, "CallExpression") &&
    wrapperCall.arguments[0] === renderArgument &&
    isReactApiCall(wrapperCall, "forwardRef", scopes, { resolveNamedAliases: true }),
  );
};
