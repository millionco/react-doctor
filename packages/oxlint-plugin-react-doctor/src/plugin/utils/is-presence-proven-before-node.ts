import type { EsTreeNode } from "./es-tree-node.js";
import { isEarlyExitStatement } from "./is-early-exit-statement.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { unwrapNegativeGuardForm } from "./unwrap-negative-guard-form.js";

const positiveFormForFalsyBranch = (test: EsTreeNode): EsTreeNode | null =>
  unwrapNegativeGuardForm(test);

export const isPresenceProvenBeforeNode = (
  node: EsTreeNode,
  testProvesPresence: (test: EsTreeNode) => boolean,
): boolean => {
  let child = node;
  let ancestor = node.parent ?? null;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (isNodeOfType(ancestor, "LogicalExpression") && ancestor.right === child) {
      if (ancestor.operator === "&&" && testProvesPresence(ancestor.left as EsTreeNode)) {
        return true;
      }
      const positiveForm = positiveFormForFalsyBranch(ancestor.left as EsTreeNode);
      if (ancestor.operator === "||" && positiveForm && testProvesPresence(positiveForm)) {
        return true;
      }
    }
    if (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) {
      if (ancestor.consequent === child && testProvesPresence(ancestor.test as EsTreeNode)) {
        return true;
      }
      if (ancestor.alternate === child) {
        const positiveForm = positiveFormForFalsyBranch(ancestor.test as EsTreeNode);
        if (positiveForm && testProvesPresence(positiveForm)) return true;
      }
    }
    if (
      (isNodeOfType(ancestor, "WhileStatement") || isNodeOfType(ancestor, "ForStatement")) &&
      ancestor.body === child &&
      ancestor.test &&
      testProvesPresence(ancestor.test as EsTreeNode)
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const childIndex = ancestor.body.findIndex((statement) => statement === child);
      for (let index = 0; index < childIndex; index += 1) {
        const statement = ancestor.body[index];
        if (!isNodeOfType(statement, "IfStatement")) continue;
        if (isEarlyExitStatement(statement.consequent)) {
          const positiveForm = positiveFormForFalsyBranch(statement.test as EsTreeNode);
          if (positiveForm && testProvesPresence(positiveForm)) return true;
        }
        if (
          statement.alternate &&
          isEarlyExitStatement(statement.alternate) &&
          testProvesPresence(statement.test as EsTreeNode)
        ) {
          return true;
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};
