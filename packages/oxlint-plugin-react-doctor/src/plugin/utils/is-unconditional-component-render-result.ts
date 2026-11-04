import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getSymbolReferenceIndex } from "./get-symbol-reference-index.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isUppercaseName } from "./is-uppercase-name.js";

export const isUnconditionalComponentRenderResult = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const owner = findEnclosingFunction(expression);
  if (!isNodeOfType(owner, "ArrowFunctionExpression") || owner.async) return false;
  const binding = owner.parent;
  if (
    !isNodeOfType(binding, "VariableDeclarator") ||
    binding.init !== owner ||
    !isNodeOfType(binding.id, "Identifier") ||
    !isUppercaseName(binding.id.name) ||
    !isNodeOfType(binding.parent, "VariableDeclaration") ||
    binding.parent.kind !== "const"
  )
    return false;
  const program = findProgramRoot(owner);
  const symbol = scopes.symbolFor(binding.id);
  if (!program || !symbol || !hasCompleteSymbolReferences(symbol, program, scopes)) return false;
  const index = getSymbolReferenceIndex(program, scopes);
  for (const candidateSymbol of index.resolvedNodes.keys()) {
    if (candidateSymbol !== symbol && candidateSymbol.name === symbol.name) return false;
  }
  const references = index.resolvedNodes.get(symbol) ?? [];
  if (
    !references.every((reference) => {
      if (reference === symbol.bindingIdentifier) return true;
      const parent = reference.parent;
      return (
        isNodeOfType(reference, "JSXIdentifier") &&
        (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
        parent.name === reference
      );
    })
  )
    return false;
  const returned = getSingleReturnExpression(owner);
  if (!returned) return false;
  let current = expression;
  while (current !== returned) {
    const transparentRoot = findTransparentExpressionRoot(current);
    if (transparentRoot !== current) {
      current = transparentRoot;
      continue;
    }
    const parent = current.parent;
    if (
      isNodeOfType(parent, "JSXExpressionContainer") &&
      parent.expression === current &&
      isNodeOfType(parent.parent, "JSXElement") &&
      parent.parent.children.some((child) => child === parent)
    ) {
      current = parent;
      continue;
    }
    if (
      !isNodeOfType(parent, "JSXElement") ||
      !parent.children.some((child) => child === current) ||
      !isNodeOfType(parent.openingElement.name, "JSXIdentifier") ||
      !HTML_TAGS.has(parent.openingElement.name.name)
    )
      return false;
    current = parent;
  }
  return true;
};
