import { createStoredDisposerCleanupProof } from "./create-stored-disposer-cleanup-proof.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { doNodesCoverEveryPathAfterNode } from "./do-nodes-cover-every-path-after-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "./get-function-binding-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";

interface StoredEffectDisposerOptions {
  context: RuleContext;
  effectCallback: EsTreeNode;
  resourceNode: EsTreeNode;
  doesFunctionReleaseResource: (functionNode: EsTreeNode) => boolean;
}

export const doesEffectInvokeStoredDisposer = ({
  context,
  effectCallback,
  resourceNode,
  doesFunctionReleaseResource,
}: StoredEffectDisposerOptions): boolean => {
  const resourceOwner = findEnclosingFunction(resourceNode);
  if (
    !resourceOwner ||
    !isFunctionLike(resourceOwner) ||
    resourceOwner.async ||
    resourceOwner === effectCallback ||
    !isNodeOfType(resourceOwner.body, "BlockStatement")
  ) {
    return false;
  }
  const disposerReturns = collectFunctionReturnStatements(resourceOwner, context.scopes).filter(
    (returnStatement) => {
      const returnedValue = returnStatement.argument
        ? stripParenExpression(returnStatement.argument)
        : null;
      return Boolean(returnedValue && doesFunctionReleaseResource(returnedValue));
    },
  );
  if (!doNodesCoverEveryPathAfterNode(resourceNode, disposerReturns, context, resourceNode)) {
    return false;
  }
  const resourceOwnerBinding = getFunctionBindingIdentifier(resourceOwner);
  const resourceOwnerSymbol = resourceOwnerBinding
    ? context.scopes.symbolFor(resourceOwnerBinding)
    : null;
  if (!resourceOwnerSymbol || resourceOwnerSymbol.references.length !== 1) return false;
  const resourceOwnerReference = resourceOwnerSymbol.references[0];
  if (!resourceOwnerReference) return false;
  const resourceOwnerReferenceRoot = findTransparentExpressionRoot(
    resourceOwnerReference.identifier,
  );
  const resourceOwnerCall = resourceOwnerReferenceRoot.parent;
  const resourceOwnerCallRoot = isNodeOfType(resourceOwnerCall, "CallExpression")
    ? findTransparentExpressionRoot(resourceOwnerCall)
    : null;
  const storageAssignment = resourceOwnerCallRoot?.parent;
  if (
    !isNodeOfType(resourceOwnerCall, "CallExpression") ||
    resourceOwnerCall.callee !== resourceOwnerReferenceRoot ||
    !isNodeOfType(storageAssignment, "AssignmentExpression") ||
    storageAssignment.operator !== "=" ||
    storageAssignment.right !== resourceOwnerCallRoot ||
    !isNodeOfType(storageAssignment.left, "Identifier") ||
    findEnclosingFunction(storageAssignment) !== effectCallback
  ) {
    return false;
  }
  const proveStoredDisposerCleanup = createStoredDisposerCleanupProof({
    context,
    effectCallback,
    storageAssignment,
  });
  if (!proveStoredDisposerCleanup) return false;
  const matchingCleanupReturns = collectFunctionReturnStatements(
    effectCallback,
    context.scopes,
  ).filter((returnStatement) => {
    const cleanupFunction = returnStatement.argument
      ? resolveExactLocalFunction(returnStatement.argument, context.scopes)
      : null;
    return Boolean(cleanupFunction && proveStoredDisposerCleanup(cleanupFunction, returnStatement));
  });
  return doNodesCoverEveryPathAfterNode(
    storageAssignment,
    matchingCleanupReturns,
    context,
    storageAssignment,
  );
};
