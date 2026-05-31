import { collectReactReduxSelectorAliases } from "../../utils/collect-react-redux-selector-aliases.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { inlineUseSelectorFunction } from "./utils/inline-use-selector-function.js";

const MESSAGE =
  "Your component re-renders on every dispatched action when useSelector returns a new object or array.";

const isConciseBodyReturningCollection = (functionNode: EsTreeNode): boolean => {
  if (
    !isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode, "FunctionExpression")
  ) {
    return false;
  }
  const rawBody = functionNode.body;
  if (!rawBody) return false;

  if (!isNodeOfType(rawBody, "BlockStatement")) {
    const conciseExpression = stripParenExpression(rawBody);
    return (
      isNodeOfType(conciseExpression, "ObjectExpression") ||
      isNodeOfType(conciseExpression, "ArrayExpression")
    );
  }

  const statements = rawBody.body ?? [];
  if (statements.length === 0) return false;
  const lastStatement = statements[statements.length - 1];
  if (!isNodeOfType(lastStatement, "ReturnStatement")) return false;
  if (!lastStatement.argument) return false;
  const returnedExpression = stripParenExpression(lastStatement.argument);
  return (
    isNodeOfType(returnedExpression, "ObjectExpression") ||
    isNodeOfType(returnedExpression, "ArrayExpression")
  );
};

// useSelector compares the selector's return value to the previous return
// value with `===` (Object.is) by default. A fresh `{...}` / `[...]`
// literal always fails that check, so the component re-renders on every
// dispatched action — not just when the selected data changed. The fix
// is one of:
//   - return a primitive (`state.user.name`)
//   - split into multiple useSelector calls
//   - pass `shallowEqual` from `react-redux` as the second arg
//
// Scope:
//   - matches the bare `useSelector` identifier imported from
//     `react-redux` AND same-file typed-wrapper rebindings such as
//     `const useAppSelector: TypedUseSelectorHook<RootState> =
//     useSelector` (the canonical Redux Toolkit pattern). The cross-
//     file form (typed wrapper in `hooks.ts`, used elsewhere) requires
//     module-graph resolution and remains out of scope.
//   - skipped when a second argument is present (any equality fn).
//   - inline arrow/function selectors only. Selector hoisted to an
//     identifier is skipped — those usually live alongside a `createSelector`
//     pipeline that the user knows is memoised.
export const reduxUseselectorReturnsNewCollection = defineRule<Rule>({
  id: "redux-useselector-returns-new-collection",
  title: "useSelector returns a new collection",
  severity: "warn",
  category: "Performance",
  disabledBy: ["react-compiler"],
  recommendation:
    "Return a primitive, split into multiple useSelector calls, or pass `shallowEqual` from `react-redux` as the second argument.",
  create: (context: RuleContext) => {
    let aliases: ReadonlySet<string> = new Set<string>();
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        aliases = collectReactReduxSelectorAliases(node as EsTreeNode);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const selectorArgument = inlineUseSelectorFunction(node, aliases);
        if (!selectorArgument) return;
        if (!isConciseBodyReturningCollection(selectorArgument)) return;

        context.report({ node, message: MESSAGE });
      },
    };
  },
});
