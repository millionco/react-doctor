import type { EsTreeNode } from "./es-tree-node.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";

// Used by `require-render-return`, where expression-bodied arrows count
// as a returned value and nested functions keep their own returns.
export const functionBodyHasReturnWithValue = (functionNode: EsTreeNode): boolean => {
  if (functionNode.type === "ArrowFunctionExpression" && "body" in functionNode) {
    if (functionNode.body && functionNode.body.type !== "BlockStatement") return true;
  }

  return collectFunctionReturnStatements(functionNode).some(
    (returnStatement) => returnStatement.argument != null,
  );
};
