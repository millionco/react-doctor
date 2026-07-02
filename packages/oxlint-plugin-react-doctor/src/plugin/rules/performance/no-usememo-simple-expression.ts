import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isImportedFromModule } from "../../utils/find-import-source-for-name.js";
import { isCanonicalReactNamespaceName } from "../../utils/is-canonical-react-namespace-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isSimpleExpression = (node: EsTreeNode | null): boolean => {
  if (!node) return false;
  const innerExpression = stripParenExpression(node);
  switch (innerExpression.type) {
    case "Identifier":
    case "Literal":
      return true;
    case "TemplateLiteral":
      // A template with interpolations builds a fresh string every call —
      // memoizing it caches the concatenation, which is often intentional
      // (mined FP: `useMemo(() => \`${demoUrl}${isDark ? '?theme=dark' : ''}\`)`).
      // Only a zero-interpolation template is a truly constant value.
      return (innerExpression.expressions ?? []).length === 0;
    case "BinaryExpression":
      return isSimpleExpression(innerExpression.left) && isSimpleExpression(innerExpression.right);
    case "UnaryExpression":
      return isSimpleExpression(innerExpression.argument);
    case "MemberExpression":
      return !innerExpression.computed && isSimpleExpression(innerExpression.object);
    case "ConditionalExpression":
      return (
        isSimpleExpression(innerExpression.test) &&
        isSimpleExpression(innerExpression.consequent) &&
        isSimpleExpression(innerExpression.alternate)
      );
    default:
      return false;
  }
};

// Identifiers and member-access chains are technically "simple", but memoizing
// them is sometimes intentional (stable reference passing). Only flag arithmetic
// / literal trivial cases to keep false positives low.
const isTriviallyCheapExpression = (node: EsTreeNode | null): boolean => {
  if (!node) return false;
  const innerExpression = stripParenExpression(node);
  if (!isSimpleExpression(innerExpression)) return false;
  if (isNodeOfType(innerExpression, "Identifier")) return false;
  if (isNodeOfType(innerExpression, "MemberExpression")) return false;
  return true;
};

export const noUsememoSimpleExpression = defineRule({
  id: "no-usememo-simple-expression",
  title: "useMemo on a cheap value",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Remove the useMemo. Property reads, math, and ternaries are already fast, so wrapping them doesn't help",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, "useMemo")) return;
      // Skip non-React useMemo lookalikes — `Dispatcher.useMemo(...)`,
      // `MyTestRenderer.useMemo(...)`, etc. The hook-call helper above
      // matches both `useMemo` and `React.useMemo` namespaced forms,
      // but the React-style call is always bound to `react`-flavour
      // identifiers (`React`, `react`, lowercased import alias). A
      // `Dispatcher.useMemo` is the internal scheduler API and isn't
      // governed by the same trivial-allocation reasoning.
      if (isNodeOfType(node.callee, "MemberExpression")) {
        const namespaceIdentifier = node.callee.object;
        if (isNodeOfType(namespaceIdentifier, "Identifier")) {
          const namespaceName = namespaceIdentifier.name;
          if (
            !isCanonicalReactNamespaceName(namespaceName) &&
            !isImportedFromModule(namespaceIdentifier, namespaceName, "react")
          ) {
            return;
          }
        }
      }

      const callback = node.arguments?.[0];
      if (!callback) return;
      if (
        !isNodeOfType(callback, "ArrowFunctionExpression") &&
        !isNodeOfType(callback, "FunctionExpression")
      )
        return;

      let returnExpression = null;
      if (!isNodeOfType(callback.body, "BlockStatement")) {
        returnExpression = callback.body;
      } else if (
        callback.body.body?.length === 1 &&
        isNodeOfType(callback.body.body[0], "ReturnStatement")
      ) {
        returnExpression = callback.body.body[0].argument;
      }

      if (returnExpression && isTriviallyCheapExpression(returnExpression)) {
        context.report({
          node,
          message:
            "This costs more than it saves because useMemo is wrapping a value that's already cheap, so remove the useMemo",
        });
      }
    },
  }),
});
