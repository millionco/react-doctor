import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { walkAst } from "./walk-ast.js";

export const hasLexicalReceiverReference = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let hasReceiver = false;
  walkAst(functionNode, (node) => {
    if (hasReceiver) return false;
    if (
      node !== functionNode &&
      isFunctionLike(node) &&
      !isNodeOfType(node, "ArrowFunctionExpression")
    )
      return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "Super") ||
      isNodeOfType(node, "MetaProperty")
    ) {
      hasReceiver = true;
      return false;
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      node.name !== "arguments" ||
      isNonReferenceIdentifier(node) ||
      !scopes.referenceFor(node)
    )
      return;
    const binding = scopes.symbolFor(node);
    hasReceiver =
      scopes.isGlobalReference(node) ||
      Boolean(binding && isErasedTypeScriptBinding(binding) && !hasRuntimeValueBinding(binding));
  });
  return hasReceiver;
};
