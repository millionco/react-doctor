import { defineRule } from "../../utils/define-rule.js";
import { containsDirectAwait } from "../../utils/contains-direct-await.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

interface BlockStatementPosition {
  block: EsTreeNodeOfType<"BlockStatement">;
  statementIndex: number;
}

const findBlockStatementPosition = (node: EsTreeNode): BlockStatementPosition | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current !== null && current !== undefined) {
    const parent = current.parent;
    if (isNodeOfType(parent, "BlockStatement")) {
      const statementIndex = parent.body.findIndex((statement) => statement === current);
      return statementIndex < 0 ? null : { block: parent, statementIndex };
    }
    if (
      isNodeOfType(current, "FunctionDeclaration") ||
      isNodeOfType(current, "FunctionExpression") ||
      isNodeOfType(current, "ArrowFunctionExpression")
    ) {
      return null;
    }
    current = current.parent;
  }
  return null;
};

export const reactRouterNoMultipleSetSearchParamsInTick = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-multiple-set-search-params-in-tick",
    title: "Search params updated multiple times",
    tags: ["test-noise"],
    requires: ["react-router"],
    severity: "warn",
    recommendation:
      "Combine changes into one setSearchParams call because updates in the same tick do not queue like React state.",
    create: (context: RuleContext) => ({
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "ArrayPattern")) return;
        if (!isNodeOfType(node.init, "CallExpression")) return;
        if (!isNodeOfType(node.init.callee, "Identifier")) return;
        if (
          getImportedNameFromReactRouter(context, node.init.callee, node.init.callee.name) !==
          "useSearchParams"
        ) {
          return;
        }
        const setterBinding = node.id.elements?.[1];
        if (!isNodeOfType(setterBinding, "Identifier")) return;
        const setterSymbol = context.scopes.symbolFor(setterBinding);
        if (setterSymbol === null) return;

        const previousCallByBlock = new Map<EsTreeNode, BlockStatementPosition>();
        for (const reference of setterSymbol.references) {
          const callExpression = reference.identifier.parent;
          if (
            !isNodeOfType(callExpression, "CallExpression") ||
            callExpression.callee !== reference.identifier
          ) {
            continue;
          }
          const position = findBlockStatementPosition(callExpression);
          if (position === null) continue;
          const previousPosition = previousCallByBlock.get(position.block);
          if (previousPosition === undefined) {
            previousCallByBlock.set(position.block, position);
            continue;
          }
          if (previousPosition.statementIndex === position.statementIndex) continue;
          const hasAwaitBetween = position.block.body
            .slice(previousPosition.statementIndex + 1, position.statementIndex)
            .some((statement) => containsDirectAwait(statement));
          if (hasAwaitBetween) {
            previousCallByBlock.set(position.block, position);
            continue;
          }
          context.report({
            node: callExpression,
            message: `${setterBinding.name}() is called more than once in this block, so an earlier update can be discarded.`,
          });
          previousCallByBlock.set(position.block, position);
        }
      },
    }),
  }),
);
