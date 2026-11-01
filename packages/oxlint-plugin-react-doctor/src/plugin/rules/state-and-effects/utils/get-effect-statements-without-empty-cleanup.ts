import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getCallbackStatements } from "../../../utils/get-callback-statements.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getProgramAnalysis } from "./effect/get-program-analysis.js";
import { hasCleanup } from "./effect/react.js";

export const getEffectStatementsWithoutEmptyCleanup = (
  effectCall: EsTreeNode,
  callback: EsTreeNode,
): EsTreeNode[] => {
  const statements = getCallbackStatements(callback);
  if (statements.length < 2 || !isNodeOfType(statements.at(-1), "ReturnStatement")) {
    return statements;
  }
  const analysis = getProgramAnalysis(effectCall);
  return analysis && !hasCleanup(analysis, effectCall) ? statements.slice(0, -1) : statements;
};
