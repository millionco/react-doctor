import type { EsTreeNode } from "./es-tree-node.js";
import { isEarlyExitStatement } from "./is-early-exit-statement.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { unwrapNegativeGuardForm } from "./unwrap-negative-guard-form.js";

const positiveFormForFalsyBranch = (test: EsTreeNode): EsTreeNode | null =>
  unwrapNegativeGuardForm(test);

const blockGuardIndexes = new WeakMap<
  EsTreeNode,
  {
    earlyExitGuards: Array<{
      index: number;
      positiveTest: EsTreeNode;
    }>;
    statementIndexes: Map<EsTreeNode, number>;
  }
>();

const indexBlockGuards = (block: EsTreeNode) => {
  const existing = blockGuardIndexes.get(block);
  if (existing) return existing;
  const body =
    (isNodeOfType(block, "BlockStatement") || isNodeOfType(block, "Program")) && block.body
      ? block.body
      : [];
  const statementIndexes = new Map<EsTreeNode, number>();
  const earlyExitGuards: Array<{ index: number; positiveTest: EsTreeNode }> = [];
  body.forEach((statement, index) => {
    const statementNode = statement as EsTreeNode;
    statementIndexes.set(statementNode, index);
    if (!isNodeOfType(statementNode, "IfStatement")) return;
    if (isEarlyExitStatement(statementNode.consequent)) {
      const positiveTest = positiveFormForFalsyBranch(statementNode.test as EsTreeNode);
      if (positiveTest) earlyExitGuards.push({ index, positiveTest });
    }
    if (statementNode.alternate && isEarlyExitStatement(statementNode.alternate)) {
      earlyExitGuards.push({ index, positiveTest: statementNode.test as EsTreeNode });
    }
  });
  const indexed = { earlyExitGuards, statementIndexes };
  blockGuardIndexes.set(block, indexed);
  return indexed;
};

export const isPresenceProvenBeforeNode = (
  node: EsTreeNode,
  testProvesPresence: (test: EsTreeNode) => boolean,
  nodeInvalidatesPresence?: (node: EsTreeNode) => boolean,
): boolean => {
  let child = node;
  let ancestor = node.parent ?? null;
  const enclosingBranchPrefixes: EsTreeNode[][] = [];
  const hasEnclosingInvalidation = (): boolean =>
    Boolean(
      nodeInvalidatesPresence &&
      enclosingBranchPrefixes.some((prefix) => prefix.some(nodeInvalidatesPresence)),
    );
  while (ancestor && !isFunctionLike(ancestor)) {
    if (isNodeOfType(ancestor, "LogicalExpression") && ancestor.right === child) {
      if (ancestor.operator === "&&" && testProvesPresence(ancestor.left as EsTreeNode)) {
        return !hasEnclosingInvalidation();
      }
      const positiveForm = positiveFormForFalsyBranch(ancestor.left as EsTreeNode);
      if (ancestor.operator === "||" && positiveForm && testProvesPresence(positiveForm)) {
        return !hasEnclosingInvalidation();
      }
    }
    if (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) {
      if (ancestor.consequent === child && testProvesPresence(ancestor.test as EsTreeNode)) {
        return !hasEnclosingInvalidation();
      }
      if (ancestor.alternate === child) {
        const positiveForm = positiveFormForFalsyBranch(ancestor.test as EsTreeNode);
        if (positiveForm && testProvesPresence(positiveForm)) {
          return !hasEnclosingInvalidation();
        }
      }
    }
    if (
      (isNodeOfType(ancestor, "WhileStatement") || isNodeOfType(ancestor, "ForStatement")) &&
      ancestor.body === child &&
      ancestor.test &&
      testProvesPresence(ancestor.test as EsTreeNode)
    ) {
      return !hasEnclosingInvalidation();
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const indexed = indexBlockGuards(ancestor);
      const childIndex = indexed.statementIndexes.get(child) ?? -1;
      for (const guard of indexed.earlyExitGuards) {
        if (guard.index >= childIndex) break;
        const hasInvalidatingStatement = nodeInvalidatesPresence
          ? ancestor.body
              .slice(guard.index + 1, childIndex)
              .some((statement) => nodeInvalidatesPresence(statement as EsTreeNode))
          : false;
        if (!hasInvalidatingStatement && testProvesPresence(guard.positiveTest)) return true;
      }
      enclosingBranchPrefixes.push(
        ancestor.body.slice(0, childIndex).map((statement) => statement as EsTreeNode),
      );
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};
