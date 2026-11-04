import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getCallbackStatements } from "../../../utils/get-callback-statements.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { getProgramAnalysis } from "./effect/get-program-analysis.js";
import { hasCleanup } from "./effect/react.js";

export const getEffectStatementsWithoutEmptyCleanup = (
  effectCall: EsTreeNode,
  callback: EsTreeNode,
): EsTreeNode[] => {
  const statements = getCallbackStatements(callback);
  const finalStatement = statements.at(-1);
  if (
    statements.length < 2 ||
    !isNodeOfType(finalStatement, "ReturnStatement") ||
    !finalStatement.argument ||
    !isFunctionLike(finalStatement.argument)
  ) {
    return statements;
  }
  const analysis = getProgramAnalysis(effectCall);
  return analysis && !hasCleanup(analysis, effectCall) ? statements.slice(0, -1) : statements;
};
