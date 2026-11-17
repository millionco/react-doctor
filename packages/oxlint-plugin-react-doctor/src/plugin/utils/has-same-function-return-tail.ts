import { LOOP_TYPES } from "../constants/js.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

const loopTypes: ReadonlySet<string> = new Set(LOOP_TYPES);
const returnTailStatementsByBlock = new WeakMap<EsTreeNode, ReadonlySet<EsTreeNode>>();

const hasOnlyOrdinaryStatements = (statement: EsTreeNode): boolean => {
  const pendingStatements = [statement];
  while (pendingStatements.length) {
    const nextStatement = pendingStatements.pop();
    if (!nextStatement) break;
    if (isNodeOfType(nextStatement, "BlockStatement")) {
      for (const childStatement of nextStatement.body) pendingStatements.push(childStatement);
    } else if (isNodeOfType(nextStatement, "IfStatement")) {
      pendingStatements.push(nextStatement.consequent);
      if (nextStatement.alternate) pendingStatements.push(nextStatement.alternate);
    } else if (
      !isNodeOfType(nextStatement, "ExpressionStatement") &&
      !isNodeOfType(nextStatement, "VariableDeclaration") &&
      !isNodeOfType(nextStatement, "ReturnStatement") &&
      !isNodeOfType(nextStatement, "ThrowStatement") &&
      !isNodeOfType(nextStatement, "EmptyStatement")
    ) {
      return false;
    }
  }
  return true;
};

const getReturnTailStatements = (
  block: EsTreeNodeOfType<"BlockStatement">,
): ReadonlySet<EsTreeNode> => {
  const cachedStatements = returnTailStatementsByBlock.get(block);
  if (cachedStatements) return cachedStatements;
  const returnTailStatements = new Set<EsTreeNode>();
  if (isNodeOfType(block.body.at(-1), "ReturnStatement")) {
    for (let index = block.body.length - 2; index >= 0; index--) {
      const statement = block.body[index];
      if (!statement || !hasOnlyOrdinaryStatements(statement)) break;
      if (isNodeOfType(statement, "IfStatement")) returnTailStatements.add(statement);
    }
  }
  returnTailStatementsByBlock.set(block, returnTailStatements);
  return returnTailStatements;
};

export const hasSameFunctionReturnTail = (
  expression: EsTreeNode,
  activeLoopDepth: number,
): boolean => {
  let condition = findTransparentExpressionRoot(expression);
  while (isNodeOfType(condition.parent, "LogicalExpression")) {
    condition = findTransparentExpressionRoot(condition.parent);
  }
  const branch = condition.parent;
  if (!isNodeOfType(branch, "IfStatement") || branch.test !== condition) return false;
  const block = branch.parent;
  if (!isNodeOfType(block, "BlockStatement")) return false;

  let sameFunctionLoopDepth = 0;
  let ancestor = block.parent;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (
      isNodeOfType(ancestor, "TryStatement") ||
      isNodeOfType(ancestor, "SwitchStatement") ||
      isNodeOfType(ancestor, "LabeledStatement")
    ) {
      return false;
    }
    if (loopTypes.has(ancestor.type)) sameFunctionLoopDepth += 1;
    ancestor = ancestor.parent;
  }
  return Boolean(
    ancestor &&
    sameFunctionLoopDepth > 0 &&
    sameFunctionLoopDepth === activeLoopDepth &&
    getReturnTailStatements(block).has(branch),
  );
};
