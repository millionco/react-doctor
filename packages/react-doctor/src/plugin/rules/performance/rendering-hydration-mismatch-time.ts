import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const NONDETERMINISTIC_RENDER_PATTERNS: Array<{
  matches: (node: EsTreeNode) => boolean;
  display: string;
}> = [
  {
    display: "new Date()",
    matches: (node) =>
      node.type === "NewExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "Date",
  },
  {
    display: "Date.now()",
    matches: (node) =>
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.object?.type === "Identifier" &&
      node.callee.object.name === "Date" &&
      node.callee.property?.type === "Identifier" &&
      node.callee.property.name === "now",
  },
  {
    display: "Math.random()",
    matches: (node) =>
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.object?.type === "Identifier" &&
      node.callee.object.name === "Math" &&
      node.callee.property?.type === "Identifier" &&
      node.callee.property.name === "random",
  },
  {
    display: "performance.now()",
    matches: (node) =>
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.object?.type === "Identifier" &&
      node.callee.object.name === "performance" &&
      node.callee.property?.type === "Identifier" &&
      node.callee.property.name === "now",
  },
  {
    display: "crypto.randomUUID()",
    matches: (node) =>
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.object?.type === "Identifier" &&
      node.callee.object.name === "crypto" &&
      node.callee.property?.type === "Identifier" &&
      node.callee.property.name === "randomUUID",
  },
];

const findOpeningElementOfChild = (jsxNode: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null = jsxNode.parent ?? null;
  while (cursor) {
    if (cursor.type === "JSXElement") return cursor.openingElement;
    if (cursor.type === "JSXFragment") return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const hasSuppressHydrationWarningAttribute = (openingElement: EsTreeNode | null): boolean => {
  if (!openingElement) return false;
  for (const attr of openingElement.attributes ?? []) {
    if (
      attr.type === "JSXAttribute" &&
      attr.name?.type === "JSXIdentifier" &&
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
export const renderingHydrationMismatchTime = defineRule<Rule>({
  recommendation:
    "Wrap dynamic time/random values in useEffect+useState (client-only) or add suppressHydrationWarning to the parent if intentional",
  create: (context: RuleContext) => ({
    JSXExpressionContainer(node: EsTreeNode) {
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
          message: `${matched.display} in JSX renders differently on server vs client — wrap in useEffect+useState (client-only) or add suppressHydrationWarning to the parent if intentional`,
        });
        return;
      }

      // Method-chained on a Date / Math / etc. — e.g. new Date().toLocaleString().
      walkAst(node.expression, (child: EsTreeNode) => {
        for (const pattern of NONDETERMINISTIC_RENDER_PATTERNS) {
          if (pattern.matches(child)) {
            const openingElement = findOpeningElementOfChild(node);
            if (hasSuppressHydrationWarningAttribute(openingElement)) return;
            context.report({
              node: child,
              message: `${pattern.display} reachable from JSX renders differently on server vs client — wrap in useEffect+useState (client-only) or add suppressHydrationWarning to the parent if intentional`,
            });
            return;
          }
        }
      });
    },
  }),
});
