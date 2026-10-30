import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../constants/thresholds.js";
import { doNodesCoverEveryPathFromFunctionEntry } from "./do-nodes-cover-every-path-from-function-entry.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { nodeDominatesNode } from "./node-dominates-node.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";

interface StoredDisposerCleanupProof {
  (cleanupFunction: EsTreeNode, cleanupReturn: EsTreeNode): ReadonlySet<EsTreeNode> | null;
}

interface StoredDisposerCleanupProofOptions {
  context: RuleContext;
  effectCallback: EsTreeNode;
  storageAssignment: EsTreeNode;
}

const directEvalByEffectCallback = new WeakMap<EsTreeNode, boolean>();

export const createStoredDisposerCleanupProof = ({
  context,
  effectCallback,
  storageAssignment,
}: StoredDisposerCleanupProofOptions): StoredDisposerCleanupProof | null => {
  if (
    !isNodeOfType(storageAssignment, "AssignmentExpression") ||
    storageAssignment.operator !== "=" ||
    !isNodeOfType(storageAssignment.left, "Identifier")
  ) {
    return null;
  }
  const storageSymbol = context.scopes.symbolFor(storageAssignment.left);
  const initializer = storageSymbol?.initializer
    ? stripParenExpression(storageSymbol.initializer)
    : null;
  if (
    !storageSymbol ||
    (storageSymbol.kind !== "let" && storageSymbol.kind !== "var") ||
    !isNodeOfType(storageSymbol.declarationNode, "VariableDeclarator") ||
    findEnclosingFunction(storageSymbol.declarationNode) !== effectCallback ||
    !initializer ||
    !isFunctionLike(initializer) ||
    !isNodeOfType(initializer.body, "BlockStatement") ||
    initializer.body.body.length !== 0
  ) {
    return null;
  }
  const cleanupCallsByFunction = new Map<EsTreeNode, EsTreeNode[]>();
  for (const reference of storageSymbol.references) {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const referenceParent = referenceRoot.parent;
    if (referenceParent === storageAssignment && storageAssignment.left === referenceRoot) {
      continue;
    }
    if (
      !isNodeOfType(referenceParent, "CallExpression") ||
      referenceParent.callee !== referenceRoot
    ) {
      return null;
    }
    const callOwner = findEnclosingFunction(referenceParent);
    if (!callOwner) return null;
    const cleanupCalls = cleanupCallsByFunction.get(callOwner) ?? [];
    cleanupCalls.push(referenceParent);
    cleanupCallsByFunction.set(callOwner, cleanupCalls);
  }
  const collectStoredDisposerCleanupHelpers = (
    cleanupFunction: EsTreeNode,
    cleanupReturn: EsTreeNode,
    visitedCleanupFunctions: ReadonlySet<EsTreeNode> = new Set(),
  ): Set<EsTreeNode> | null => {
    if (
      visitedCleanupFunctions.has(cleanupFunction) ||
      visitedCleanupFunctions.size >= FUNCTION_RESOLUTION_MAX_DEPTH
    ) {
      return null;
    }
    if (
      doNodesCoverEveryPathFromFunctionEntry(
        cleanupFunction,
        cleanupCallsByFunction.get(cleanupFunction) ?? [],
        context,
      )
    ) {
      return new Set();
    }
    if (
      !isNodeOfType(cleanupFunction, "ArrowFunctionExpression") ||
      cleanupFunction.async ||
      cleanupFunction.params.length > 0
    ) {
      return null;
    }
    const returnedExpression = getSingleReturnExpression(cleanupFunction);
    const onlyStatement =
      isNodeOfType(cleanupFunction.body, "BlockStatement") && cleanupFunction.body.body.length === 1
        ? cleanupFunction.body.body[0]
        : null;
    const cleanupExpression =
      returnedExpression ??
      (isNodeOfType(onlyStatement, "ExpressionStatement") ? onlyStatement.expression : null);
    const cleanupCall = cleanupExpression ? stripParenExpression(cleanupExpression) : null;
    const helperIdentifier = isNodeOfType(cleanupCall, "CallExpression")
      ? stripParenExpression(cleanupCall.callee)
      : null;
    if (
      !isNodeOfType(cleanupCall, "CallExpression") ||
      cleanupCall.optional ||
      cleanupCall.arguments.length > 0 ||
      !isNodeOfType(helperIdentifier, "Identifier")
    ) {
      return null;
    }
    const helperSymbol = context.scopes.symbolFor(helperIdentifier);
    const helperFunction = helperSymbol?.initializer
      ? stripParenExpression(helperSymbol.initializer)
      : null;
    if (
      !helperSymbol ||
      helperSymbol.kind !== "const" ||
      helperSymbol.references.length !== 1 ||
      helperSymbol.references[0]?.identifier !== helperIdentifier ||
      findEnclosingFunction(helperSymbol.declarationNode) !== effectCallback ||
      !nodeDominatesNode(helperSymbol.declarationNode, cleanupReturn, context) ||
      !isNodeOfType(helperFunction, "ArrowFunctionExpression") ||
      helperFunction.async ||
      helperFunction.params.length > 0
    ) {
      return null;
    }
    let hasDirectEval = directEvalByEffectCallback.get(effectCallback);
    if (hasDirectEval === undefined) {
      hasDirectEval = false;
      walkAst(effectCallback, (child) => {
        if (hasDirectEval || !isNodeOfType(child, "CallExpression")) return;
        const callee = stripParenExpression(child.callee);
        if (isNodeOfType(callee, "Identifier") && callee.name === "eval") hasDirectEval = true;
      });
      directEvalByEffectCallback.set(effectCallback, hasDirectEval);
    }
    if (hasDirectEval) return null;
    const helperDeclarations = collectStoredDisposerCleanupHelpers(
      helperFunction,
      cleanupReturn,
      new Set([...visitedCleanupFunctions, cleanupFunction]),
    );
    if (helperDeclarations) helperDeclarations.add(helperSymbol.declarationNode);
    return helperDeclarations;
  };
  return collectStoredDisposerCleanupHelpers;
};
