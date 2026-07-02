import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isJsxElementOrFragment } from "../../utils/is-jsx-element-or-fragment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isJsxExpression = (node: EsTreeNode | null | undefined): boolean =>
  Boolean(node && isJsxElementOrFragment(stripParenExpression(node)));

const callbackReturnsJsx = (callback: EsTreeNode | undefined): boolean => {
  if (!callback) return false;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return false;
  }
  const body = callback.body;
  if (isJsxExpression(body)) return true;
  if (!isNodeOfType(body, "BlockStatement")) return false;
  for (const stmt of body.body ?? []) {
    if (isNodeOfType(stmt, "ReturnStatement") && isJsxExpression(stmt.argument)) {
      return true;
    }
  }
  return false;
};

const returnArgumentUsesAnyName = (
  returnStatement: EsTreeNode,
  names: ReadonlySet<string>,
): boolean => {
  if (!isNodeOfType(returnStatement, "ReturnStatement") || !returnStatement.argument) return false;
  const referenced = new Set<string>();
  collectReferenceIdentifierNames(stripParenExpression(returnStatement.argument), referenced);
  for (const name of names) {
    if (referenced.has(name)) return true;
  }
  return false;
};

// An early return is only wasteful when its bail path does NOT consume the
// memoized value (directly or through an intermediate binding). `if (cond)
// return content;` uses the memo on both branches, so the work isn't
// wasted — skip it. We report only when there is an early return whose
// returned expression doesn't reference the memo or any of its consumers.
const hasEarlyReturnNotUsingMemo = (
  ifStatement: EsTreeNode,
  memoConsumerNames: ReadonlySet<string>,
): boolean => {
  if (!isNodeOfType(ifStatement, "IfStatement")) return false;
  const consequent = ifStatement.consequent;
  if (!consequent) return false;
  const returns: EsTreeNode[] = [];
  if (isNodeOfType(consequent, "ReturnStatement")) {
    returns.push(consequent);
  } else if (isNodeOfType(consequent, "BlockStatement")) {
    for (const stmt of consequent.body ?? []) {
      if (isNodeOfType(stmt, "ReturnStatement")) returns.push(stmt);
    }
  }
  if (returns.length === 0) return false;
  return returns.some(
    (returnStatement) => !returnArgumentUsesAnyName(returnStatement, memoConsumerNames),
  );
};

const addTransitiveConsumerNames = (
  statement: EsTreeNode,
  memoConsumerNames: Set<string>,
): void => {
  if (!isNodeOfType(statement, "VariableDeclaration")) return;
  for (const declarator of statement.declarations ?? []) {
    if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) continue;
    const referenced = new Set<string>();
    collectReferenceIdentifierNames(declarator.init, referenced);
    for (const name of memoConsumerNames) {
      if (referenced.has(name)) {
        memoConsumerNames.add(declarator.id.name);
        break;
      }
    }
  }
};

// HACK: `useMemo(() => <jsx/>)` followed by an early return wastes the
// memoization — the useMemo callback runs every render even when the
// component bails out (loading, gated, etc.). Better to extract the JSX
// into a memoized child component so the parent's early return
// short-circuits before the child renders.
export const rerenderMemoBeforeEarlyReturn = defineRule({
  id: "rerender-memo-before-early-return",
  title: "useMemo before an early return",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move the JSX into a child component wrapped in memo, so the parent's early return skips it",
  create: (context: RuleContext) => {
    const inspectFunctionBody = (statements: EsTreeNode[]): void => {
      let memoNode: EsTreeNode | null = null;
      const memoConsumerNames = new Set<string>();

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
              if (isNodeOfType(declarator.id, "Identifier")) {
                memoConsumerNames.add(declarator.id.name);
              }
              break;
            }
          }
          continue;
        }
        addTransitiveConsumerNames(stmt, memoConsumerNames);
        if (
          isNodeOfType(stmt, "IfStatement") &&
          memoConsumerNames.size > 0 &&
          hasEarlyReturnNotUsingMemo(stmt, memoConsumerNames)
        ) {
          context.report({
            node: memoNode,
            message:
              "This runs even when the component bails out because the useMemo builds JSX before an early return, so move the JSX into a child wrapped in memo to skip it on the early return",
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
