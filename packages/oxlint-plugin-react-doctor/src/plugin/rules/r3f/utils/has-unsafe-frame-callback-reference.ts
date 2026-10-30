import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isFunctionMetadataRead } from "../../../utils/is-function-metadata-read.js";
import { isInsideStaticallyUnreachableBranch } from "../../../utils/is-inside-statically-unreachable-branch.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { readStaticLiteralTruthiness } from "../../../utils/read-static-literal-truthiness.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface FrameCallbackReferenceOptions {
  callback: EsTreeNode;
  scopes: ScopeAnalysis;
}

export const hasUnsafeFrameCallbackReference = ({
  callback,
  scopes,
}: FrameCallbackReferenceOptions): boolean => {
  if (isNodeOfType(callback, "ArrowFunctionExpression")) return false;
  if (!isNodeOfType(callback, "FunctionExpression")) return true;
  if (callback.id) {
    const callbackSymbol = scopes.symbolFor(callback.id);
    if (
      !callbackSymbol ||
      callbackSymbol.references.some((reference) => {
        if (
          isInsideStaticallyUnreachableBranch(reference.identifier, {
            executionBoundary: findEnclosingFunction(reference.identifier),
            readLiteralTruthiness: readStaticLiteralTruthiness,
          })
        ) {
          return false;
        }
        return reference.flag !== "read" || !isFunctionMetadataRead(reference.identifier);
      })
    ) {
      return true;
    }
  }
  let hasUnsafeReference = false;
  const visitReference = (node: EsTreeNode): boolean | void => {
    if (hasUnsafeReference) return false;
    if (isFunctionLike(node) && !isNodeOfType(node, "ArrowFunctionExpression")) return false;
    if (isNodeOfType(node, "StaticBlock")) return false;
    if (isNodeOfType(node, "PropertyDefinition")) {
      if (node.computed) walkAst(node.key, visitReference);
      for (const decorator of node.decorators ?? []) walkAst(decorator, visitReference);
      return false;
    }
    const isReceiver = isNodeOfType(node, "ThisExpression");
    const isImplicitArguments =
      isNodeOfType(node, "Identifier") &&
      node.name === "arguments" &&
      scopes.isGlobalReference(node);
    if (!isReceiver && !isImplicitArguments) return;
    if (
      isInsideStaticallyUnreachableBranch(node, {
        executionBoundary: callback,
        readLiteralTruthiness: readStaticLiteralTruthiness,
      })
    ) {
      return;
    }
    const referenceRoot = findTransparentExpressionRoot(node);
    const parent = referenceRoot.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === referenceRoot) {
      const propertyName = getStaticPropertyKeyName(parent, {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      const identityProperty = isReceiver ? "current" : "callee";
      if (propertyName === identityProperty || propertyName === null) {
        hasUnsafeReference = propertyName === null || !isFunctionMetadataRead(parent);
        return;
      }
      const memberRoot = findTransparentExpressionRoot(parent);
      const consumer = memberRoot.parent;
      const isDiscardedRead =
        (isNodeOfType(consumer, "ExpressionStatement") && consumer.expression === memberRoot) ||
        (isNodeOfType(consumer, "UnaryExpression") &&
          (consumer.operator === "void" || consumer.operator === "typeof") &&
          consumer.argument === memberRoot);
      hasUnsafeReference = !isDiscardedRead && !isFunctionMetadataRead(parent);
      return;
    }
    if (
      isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "void" &&
      parent.argument === referenceRoot
    ) {
      return;
    }
    hasUnsafeReference = !isFunctionMetadataRead(node);
  };
  walkAst(callback.body, visitReference);
  return hasUnsafeReference;
};
