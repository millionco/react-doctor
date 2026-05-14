import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const callbackReturnsJsx = (callback: EsTreeNode | undefined): boolean => {
  if (!callback) return false;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return false;
  }
  const body = callback.body;
  if (isNodeOfType(body, "JSXElement") || isNodeOfType(body, "JSXFragment")) return true;
  if (!isNodeOfType(body, "BlockStatement")) return false;
  for (const stmt of body.body ?? []) {
    if (
      isNodeOfType(stmt, "ReturnStatement") &&
      (isNodeOfType(stmt.argument, "JSXElement") || isNodeOfType(stmt.argument, "JSXFragment"))
    ) {
      return true;
    }
  }
  return false;
};

const containsEarlyReturn = (ifStatement: EsTreeNode): boolean => {
  if (!isNodeOfType(ifStatement, "IfStatement")) return false;
  const consequent = ifStatement.consequent;
  if (!consequent) return false;
  if (isNodeOfType(consequent, "ReturnStatement")) return true;
  if (!isNodeOfType(consequent, "BlockStatement")) return false;
  for (const stmt of consequent.body ?? []) {
    if (isNodeOfType(stmt, "ReturnStatement")) return true;
  }
  return false;
};

// HACK: `useMemo(() => <jsx/>)` followed by an early return wastes the
// memoization — the useMemo callback runs every render even when the
// component bails out (loading, gated, etc.). Better to extract the JSX
// into a memoized child component so the parent's early return
// short-circuits before the child renders.
export const rerenderMemoBeforeEarlyReturn = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Extract the JSX into a memoized child component so the parent's early return short-circuits before the child renders",
  examples: [
    {
      before:
        "function Page({ rows, loading }) {\n  const list = useMemo(() => <List rows={rows} />, [rows]);\n  if (loading) return <Spinner />;\n  return list;\n}",
      after:
        "const MemoList = memo(List);\nfunction Page({ rows, loading }) {\n  if (loading) return <Spinner />;\n  return <MemoList rows={rows} />;\n}",
    },
  ],
  create: (context: RuleContext) => {
    const inspectFunctionBody = (statements: EsTreeNode[]): void => {
      let memoNode: EsTreeNode | null = null;

      for (const stmt of statements) {
        if (!memoNode) {
          if (!isNodeOfType(stmt, "VariableDeclaration")) continue;
          for (const declarator of stmt.declarations ?? []) {
            const init = declarator.init;
            if (
              isNodeOfType(init, "CallExpression") &&
              isHookCall(init, "useMemo") &&
              callbackReturnsJsx(init.arguments?.[0])
            ) {
              memoNode = declarator;
              break;
            }
          }
          continue;
        }
        if (isNodeOfType(stmt, "IfStatement") && containsEarlyReturn(stmt)) {
          context.report({
            node: memoNode,
            message:
              "useMemo returning JSX runs before an early return — extract the JSX into a memoized child component so the parent bails out before the subtree renders",
          });
          return;
        }
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!isUppercaseName(node.id?.name ?? "")) return;
        if (!isNodeOfType(node.body, "BlockStatement")) return;
        inspectFunctionBody(node.body.body ?? []);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        const body = node.init.body;
        if (!isNodeOfType(body, "BlockStatement")) return;
        inspectFunctionBody(body.body ?? []);
      },
    };
  },
});
