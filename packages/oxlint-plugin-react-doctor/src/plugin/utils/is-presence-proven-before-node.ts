import type { EsTreeNode } from "./es-tree-node.js";
import { isEarlyExitStatement } from "./is-early-exit-statement.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { unwrapNegativeGuardForm } from "./unwrap-negative-guard-form.js";

const positiveFormsForFalsyBranch = (test: EsTreeNode): EsTreeNode[] => {
  const pendingTests = [test];
  const positiveForms: EsTreeNode[] = [];
  while (pendingTests.length > 0) {
    const candidate = pendingTests.pop();
    if (!candidate) continue;
    const expression = stripParenExpression(candidate);
    if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "||") {
      pendingTests.push(expression.right, expression.left);
      continue;
    }
    const positiveForm = unwrapNegativeGuardForm(expression);
    if (positiveForm) positiveForms.push(positiveForm);
  }
  return positiveForms;
};

interface EarlyExitPresenceGuard {
  index: number;
  positiveTest: EsTreeNode;
  exitStatement: EsTreeNode;
  hasStructuralExit: boolean;
}

interface BlockPresenceGuardIndex {
  earlyExitGuards: EarlyExitPresenceGuard[];
  statementIndexes: Map<EsTreeNode, number>;
}

const blockGuardIndexes = new WeakMap<EsTreeNode, BlockPresenceGuardIndex>();

const indexBlockGuards = (block: EsTreeNode) => {
  const existing = blockGuardIndexes.get(block);
  if (existing) return existing;
  const body =
    (isNodeOfType(block, "BlockStatement") || isNodeOfType(block, "Program")) && block.body
      ? block.body
      : [];
  const statementIndexes = new Map<EsTreeNode, number>();
  const earlyExitGuards: EarlyExitPresenceGuard[] = [];
  body.forEach((statement, index) => {
    const statementNode = statement as EsTreeNode;
    statementIndexes.set(statementNode, index);
    if (!isNodeOfType(statementNode, "IfStatement")) return;
    const consequentHasStructuralExit = isEarlyExitStatement(statementNode.consequent);
    for (const positiveTest of positiveFormsForFalsyBranch(statementNode.test as EsTreeNode)) {
      earlyExitGuards.push({
        index,
        positiveTest,
        exitStatement: statementNode.consequent,
        hasStructuralExit: consequentHasStructuralExit,
      });
    }
    if (statementNode.alternate) {
      earlyExitGuards.push({
        index,
        positiveTest: statementNode.test as EsTreeNode,
        exitStatement: statementNode.alternate,
        hasStructuralExit: isEarlyExitStatement(statementNode.alternate),
      });
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
  additionalEarlyExit?: (statement: EsTreeNode) => boolean,
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
      if (
        ancestor.operator === "||" &&
        positiveFormsForFalsyBranch(ancestor.left as EsTreeNode).some(testProvesPresence)
      ) {
        return !hasEnclosingInvalidation();
      }
    }
    if (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) {
      if (ancestor.consequent === child && testProvesPresence(ancestor.test as EsTreeNode)) {
        return !hasEnclosingInvalidation();
      }
      if (ancestor.alternate === child) {
        if (positiveFormsForFalsyBranch(ancestor.test as EsTreeNode).some(testProvesPresence)) {
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
        if (!guard.hasStructuralExit && !additionalEarlyExit?.(guard.exitStatement)) continue;
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
