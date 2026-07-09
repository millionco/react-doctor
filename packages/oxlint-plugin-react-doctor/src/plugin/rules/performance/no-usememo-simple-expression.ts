import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isImportedFromModule } from "../../utils/find-import-source-for-name.js";
import { isCanonicalReactNamespaceName } from "../../utils/is-canonical-react-namespace-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

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

// A flat array/object literal whose parts are all simple reads —
// `[x]`, `{ a, b }`. Rebuilding one costs a few nanoseconds, so the
// memo only pays for itself when the RESULT'S IDENTITY is consumed
// (dep / prop / escaping value). Spreads, computed keys, and nested
// containers are excluded.
const isTrivialContainerLiteral = (node: EsTreeNode | null): boolean => {
  if (!node) return false;
  const innerExpression = stripParenExpression(node);
  if (isNodeOfType(innerExpression, "ArrayExpression")) {
    return (innerExpression.elements ?? []).every(
      (element) => element !== null && isSimpleExpression(element),
    );
  }
  if (isNodeOfType(innerExpression, "ObjectExpression")) {
    return (innerExpression.properties ?? []).every(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        isSimpleExpression(property.value),
    );
  }
  return false;
};

// True when the reference can never leak the container's identity —
// it's only read THROUGH (`value.length`, `value.map(...)`, `value[0]`).
const isNonEscapingRead = (identifier: EsTreeNode): boolean => {
  const parentNode = identifier.parent;
  return isNodeOfType(parentNode, "MemberExpression") && parentNode.object === identifier;
};

// Decide whether the memoized container's referential identity is ever
// consumed. Fires only in provably identity-free shapes:
//   - the result is discarded (`useMemo(...)` in statement position),
//   - the result is immediately destructured (container identity gone),
//   - every read of the result binding stays behind a member access.
// Anything else — passed as a prop, listed in deps, returned, spread —
// might rely on the stable reference, which is the legitimate use of
// memoizing a fresh container.
const isMemoIdentityUnused = (
  memoCallNode: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const parentNode = memoCallNode.parent;
  if (isNodeOfType(parentNode, "ExpressionStatement")) return true;
  if (!isNodeOfType(parentNode, "VariableDeclarator") || parentNode.init !== memoCallNode) {
    return false;
  }
  const bindingTarget = parentNode.id;
  if (isNodeOfType(bindingTarget, "ArrayPattern") || isNodeOfType(bindingTarget, "ObjectPattern")) {
    return true;
  }
  if (!isNodeOfType(bindingTarget, "Identifier")) return false;
  const symbol = scopes.symbolFor(bindingTarget);
  if (!symbol) return false;
  return symbol.references.every(
    (reference) => reference.flag === "read" && isNonEscapingRead(reference.identifier),
  );
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

      if (!returnExpression) return;

      if (isTriviallyCheapExpression(returnExpression)) {
        context.report({
          node,
          message:
            "This costs more than it saves because useMemo is wrapping a value that's already cheap, so remove the useMemo",
        });
        return;
      }

      if (
        isTrivialContainerLiteral(returnExpression) &&
        isMemoIdentityUnused(node, context.scopes)
      ) {
        context.report({
          node,
          message:
            "This useMemo rebuilds a tiny literal whose reference is never relied on, so remove the useMemo and build the value inline",
        });
      }
    },
  }),
});
