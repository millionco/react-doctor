import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface BooleanGuardReference {
  key: string;
  polarity: boolean;
}

const getStableBooleanGuardReference = (
  test: EsTreeNode,
  scopes: ScopeAnalysis,
): BooleanGuardReference | null => {
  const stripped = stripParenExpression(test);
  if (isNodeOfType(stripped, "UnaryExpression") && stripped.operator === "!") {
    const argument = getStableBooleanGuardReference(stripped.argument, scopes);
    return argument ? { ...argument, polarity: !argument.polarity } : null;
  }
  if (!isNodeOfType(stripped, "Identifier")) return null;
  const symbol = scopes.symbolFor(stripped);
  if (!symbol) return null;
  if (symbol.references.some((reference) => reference.flag !== "read")) return null;
  return { key: `symbol:${String(symbol.id)}`, polarity: true };
};

export const areNodesOnContradictoryGuardBranches = (
  firstNode: EsTreeNode,
  secondNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const firstRequirements = new Map<string, boolean>();
  let firstChild = firstNode;
  let firstAncestor: EsTreeNode | null | undefined = firstNode.parent;
  while (firstAncestor) {
    if (isFunctionLike(firstAncestor)) break;
    if (isNodeOfType(firstAncestor, "IfStatement")) {
      const guard = getStableBooleanGuardReference(firstAncestor.test, scopes);
      if (guard) {
        if (firstAncestor.consequent === firstChild) {
          firstRequirements.set(guard.key, guard.polarity);
        } else if (firstAncestor.alternate === firstChild) {
          firstRequirements.set(guard.key, !guard.polarity);
        }
      }
    }
    firstChild = firstAncestor;
    firstAncestor = firstAncestor.parent ?? null;
  }

  let secondChild = secondNode;
  let secondAncestor: EsTreeNode | null | undefined = secondNode.parent;
  while (secondAncestor) {
    if (isFunctionLike(secondAncestor)) break;
    if (isNodeOfType(secondAncestor, "IfStatement")) {
      const guard = getStableBooleanGuardReference(secondAncestor.test, scopes);
      if (guard) {
        let requiredValue: boolean | null = null;
        if (secondAncestor.consequent === secondChild) {
          requiredValue = guard.polarity;
        } else if (secondAncestor.alternate === secondChild) {
          requiredValue = !guard.polarity;
        }
        if (requiredValue !== null) {
          const firstRequiredValue = firstRequirements.get(guard.key);
          if (firstRequiredValue !== undefined && firstRequiredValue !== requiredValue) return true;
        }
      }
    }
    secondChild = secondAncestor;
    secondAncestor = secondAncestor.parent ?? null;
  }
  return false;
};
