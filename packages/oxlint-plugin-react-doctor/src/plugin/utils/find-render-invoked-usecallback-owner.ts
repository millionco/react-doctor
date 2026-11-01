import type { EsTreeNode } from "./es-tree-node.js";
import {
  componentOrHookDisplayNameForFunction,
  findComponentHocExpressionRoot,
} from "./component-or-hook-display-name.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getTransparentReactCallbackWrapperArgument } from "./get-transparent-react-callback-wrapper-argument.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeOnUnconditionalPath } from "./is-node-on-unconditional-path.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { isProvenSynchronousRenderCallback } from "./is-proven-synchronous-render-callback.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isSupportedUseCallbackExecutionPath } from "./is-supported-usecallback-execution-path.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const CALLBACK_REACHABILITY_OPTIONS = { evaluatePrimitiveLiteralTruthiness: true };

const hasOpaqueCallbackInputs = (callback: EsTreeNode): boolean => {
  if (!isFunctionLike(callback) || callback.params.length !== 0) return true;
  let hasOpaqueInputs = false;
  walkAst(callback.body, (node) => {
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Identifier") && node.name === "arguments")
    ) {
      hasOpaqueInputs = true;
      return false;
    }
  });
  return hasOpaqueInputs;
};

export const findRenderInvokedUseCallbackOwner = (
  node: EsTreeNode,
  context: RuleContext,
  visitedFunctions: ReadonlySet<EsTreeNode> = new Set(),
): EsTreeNode | null => {
  if (!isNodeReachableWithinFunction(node, context, CALLBACK_REACHABILITY_OPTIONS)) return null;
  const callbackFunction = findEnclosingFunction(node);
  if (
    !callbackFunction ||
    !isFunctionLike(callbackFunction) ||
    callbackFunction.async ||
    callbackFunction.generator ||
    hasOpaqueCallbackInputs(callbackFunction) ||
    !isSupportedUseCallbackExecutionPath(node, callbackFunction, context) ||
    visitedFunctions.has(callbackFunction)
  ) {
    return null;
  }
  const wrapperCall = findTransparentExpressionRoot(callbackFunction).parent;
  if (
    !isNodeOfType(wrapperCall, "CallExpression") ||
    !isProvenUnmodifiedReactApiCall(wrapperCall, "useCallback", context.scopes)
  ) {
    return null;
  }
  const declarationOwner = findEnclosingFunction(wrapperCall);
  if (
    !isFunctionLike(declarationOwner) ||
    declarationOwner.async ||
    declarationOwner.generator ||
    !componentOrHookDisplayNameForFunction(declarationOwner)
  ) {
    return null;
  }
  const declarator = findTransparentExpressionRoot(wrapperCall).parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const"
  ) {
    return null;
  }
  const callbackSymbol = context.scopes.symbolFor(declarator.id);
  const callbackArgument = getTransparentReactCallbackWrapperArgument(
    wrapperCall,
    callbackSymbol,
    context.scopes,
  );
  if (
    !callbackSymbol ||
    callbackSymbol.references.some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    ) ||
    !callbackArgument ||
    stripParenExpression(callbackArgument) !== callbackFunction
  ) {
    return null;
  }
  const nextVisitedFunctions = new Set(visitedFunctions).add(callbackFunction);
  for (const reference of callbackSymbol.references) {
    const callee = findTransparentExpressionRoot(reference.identifier);
    const call = callee.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== callee ||
      declarator.range[1] > call.range[0] ||
      !isNodeReachableWithinFunction(call, context, CALLBACK_REACHABILITY_OPTIONS)
    ) {
      continue;
    }
    let executionNode: EsTreeNode = call;
    let owner = findEnclosingFunction(executionNode);
    while (owner) {
      if (
        !isFunctionLike(owner) ||
        owner.async ||
        owner.generator ||
        !isAstDescendant(executionNode, owner.body) ||
        !isNodeReachableWithinFunction(executionNode, context, CALLBACK_REACHABILITY_OPTIONS) ||
        !isSupportedUseCallbackExecutionPath(executionNode, owner, context, {
          allowTruthyRegexGuard: owner === declarationOwner,
        })
      ) {
        break;
      }
      if (
        owner === declarationOwner &&
        componentOrHookDisplayNameForFunction(owner) &&
        !isNodeOfType(findComponentHocExpressionRoot(owner).parent, "CallExpression")
      ) {
        return owner;
      }
      if (hasOpaqueCallbackInputs(owner) || !isNodeOnUnconditionalPath(executionNode, owner)) {
        break;
      }
      if (!isProvenSynchronousRenderCallback(owner, context.scopes)) {
        const renderOwner = findRenderInvokedUseCallbackOwner(
          executionNode,
          context,
          nextVisitedFunctions,
        );
        if (renderOwner === declarationOwner) return renderOwner;
        break;
      }
      executionNode = findTransparentExpressionRoot(owner).parent ?? owner;
      owner = findEnclosingFunction(owner);
    }
  }
  return null;
};
