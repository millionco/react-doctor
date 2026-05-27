import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isImportedFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "useSelector returning a new object/array re-renders on every dispatched action — the default `===` equality check always fails on a fresh reference. Either return a primitive, split into multiple useSelector calls, or pass `shallowEqual` (or a custom equality fn) as the second argument.";

const REACT_REDUX_MODULE = "react-redux";

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

const isUseSelectorFromReactRedux = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const callee = callExpression.callee;
  if (!isNodeOfType(callee, "Identifier")) return false;
  if (callee.name !== "useSelector") return false;
  return isImportedFromModule(callExpression, callee.name, REACT_REDUX_MODULE);
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
// Scope (v1):
//   - matches the bare `useSelector` identifier imported from
//     `react-redux`. Typed wrappers (`useAppSelector`, `useTypedSelector`)
//     are intentionally NOT matched because they require cross-file
//     resolution. Same-file aliases like `const useAppSelector = useSelector`
//     are also skipped for v1.
//   - skipped when a second argument is present (any equality fn).
//   - inline arrow/function selectors only. Selector hoisted to an
//     identifier is skipped — those usually live alongside a `createSelector`
//     pipeline that the user knows is memoised.
export const reduxUseselectorReturnsNewCollection = defineRule<Rule>({
  id: "redux-useselector-returns-new-collection",
  severity: "warn",
  category: "Performance",
  disabledBy: ["react-compiler"],
  recommendation:
    "Return a primitive, split into multiple useSelector calls, or pass `shallowEqual` from `react-redux` as the second argument.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseSelectorFromReactRedux(node)) return;
      const args = node.arguments ?? [];
      if (args.length === 0) return;
      if (args.length >= 2) return;

      const selectorArgument = stripParenExpression(args[0]);
      if (!isConciseBodyReturningCollection(selectorArgument)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
