import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isLiteralVoidExpression } from "../../../utils/is-literal-void-expression.js";

export const getOwnedInputStatements = (block: EsTreeNode): readonly EsTreeNode[] =>
  isNodeOfType(block, "BlockStatement")
    ? block.body.filter(
        (statement) =>
          !isNodeOfType(statement, "EmptyStatement") &&
          !(
            isNodeOfType(statement, "ExpressionStatement") &&
            isLiteralVoidExpression(statement.expression)
          ),
      )
    : [];
