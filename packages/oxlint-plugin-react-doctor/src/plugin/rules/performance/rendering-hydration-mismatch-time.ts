import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const NONDETERMINISTIC_RENDER_PATTERNS: Array<{
  matches: (node: EsTreeNode) => boolean;
  display: string;
}> = [
  {
    display: "new Date()",
    matches: (node) =>
      isNodeOfType(node, "NewExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "Date" &&
      // `new Date(timestamp)` / `new Date(year, month, …)` are
      // deterministic conversions; only the no-arg form reads the
      // current wall clock and so differs server-vs-client.
      (node.arguments?.length ?? 0) === 0,
  },
  {
    display: "Date.now()",
    matches: (node) =>
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "Identifier") &&
      node.callee.object.name === "Date" &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "now",
  },
  {
    display: "Math.random()",
    matches: (node) =>
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "Identifier") &&
      node.callee.object.name === "Math" &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "random",
  },
  {
    display: "performance.now()",
    matches: (node) =>
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "Identifier") &&
      node.callee.object.name === "performance" &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "now",
  },
  {
    display: "crypto.randomUUID()",
    matches: (node) =>
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "Identifier") &&
      node.callee.object.name === "crypto" &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "randomUUID",
  },
];

const findOpeningElementOfChild = (jsxNode: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null = jsxNode.parent ?? null;
  while (cursor) {
    if (isNodeOfType(cursor, "JSXElement")) return cursor.openingElement;
    if (isNodeOfType(cursor, "JSXFragment")) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const hasSuppressHydrationWarningAttribute = (openingElement: EsTreeNode | null): boolean => {
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  for (const attr of openingElement.attributes ?? []) {
    if (
      isNodeOfType(attr, "JSXAttribute") &&
      isNodeOfType(attr.name, "JSXIdentifier") &&
      attr.name.name === "suppressHydrationWarning"
    ) {
      return true;
    }
  }
  return false;
};

// HACK: rendering `new Date()`, `Date.now()`, `Math.random()`, etc.
// directly inside JSX produces a different value on the server vs the
// client, causing React's hydration mismatch warning. The fix is either
// to wrap in `useEffect` + `useState` (so the dynamic value renders
// only client-side) or to add `suppressHydrationWarning` to the parent
// element when the mismatch is intentional.
export const renderingHydrationMismatchTime = defineRule({
  id: "rendering-hydration-mismatch-time",
  title: "Time or random value in JSX",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Move time or random values into useEffect+useState so they only run in the browser, or add suppressHydrationWarning to the parent if it's intentional",
  create: (context: RuleContext) => ({
    JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
      if (!node.expression) return;
      const matched = NONDETERMINISTIC_RENDER_PATTERNS.find((pattern) =>
        pattern.matches(node.expression),
      );
      // Direct call as the JSX child expression.
      if (matched) {
        const openingElement = findOpeningElementOfChild(node);
        if (hasSuppressHydrationWarningAttribute(openingElement)) return;
        context.report({
          node,
          message: `This can cause a hydration mismatch because ${matched.display} in JSX gives a different value on the server than in the browser. Move it into useEffect+useState to run only in the browser, or add suppressHydrationWarning to the parent if it's on purpose.`,
        });
        return;
      }

      // Method-chained on a Date / Math / etc. — e.g. new Date().toLocaleString().
      walkAst(node.expression, (child: EsTreeNode): boolean | void => {
        // Don't descend into nested function bodies — an arrow / function
        // passed as an event-handler or render-prop value (`onClose={(x) =>
        // { … Date.now() … }}`) runs on the user event, not during the
        // server/client render pass, so a time/random call inside it is
        // not a hydration mismatch.
        if (isFunctionLike(child)) return false;
        for (const pattern of NONDETERMINISTIC_RENDER_PATTERNS) {
          if (pattern.matches(child)) {
            const openingElement = findOpeningElementOfChild(node);
            if (hasSuppressHydrationWarningAttribute(openingElement)) return;
            context.report({
              node: child,
              message: `This can cause a hydration mismatch because ${pattern.display} reached from JSX gives a different value on the server than in the browser. Move it into useEffect+useState to run only in the browser, or add suppressHydrationWarning to the parent if it's on purpose.`,
            });
            return;
          }
        }
      });
    },
  }),
});
