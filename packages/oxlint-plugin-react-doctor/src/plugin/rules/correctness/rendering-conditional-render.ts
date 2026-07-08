import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const NUMERIC_NAME_HINTS = ["count", "length", "total", "size", "num"];

// `showCount`, `shouldShowFileSize`, `autoSize`: a boolean-verb prefix
// signals the identifier is a flag ABOUT the numeric thing, not the
// number itself. Booleans can never render a stray '0', so the numeric
// suffix is a misfire on these names.
const BOOLEAN_NAME_PREFIXES = [
  "is",
  "has",
  "had",
  "can",
  "could",
  "should",
  "shall",
  "will",
  "would",
  "did",
  "does",
  "was",
  "were",
  "show",
  "shows",
  "hide",
  "hidden",
  "allow",
  "allows",
  "auto",
  "enable",
  "enabled",
  "disable",
  "disabled",
  "with",
  "without",
];

const startsWithBooleanPrefix = (name: string): boolean =>
  BOOLEAN_NAME_PREFIXES.some((prefix) => {
    if (name.startsWith(prefix) && /[A-Z0-9_]/.test(name.charAt(prefix.length))) return true;
    return name.startsWith(`${prefix.toUpperCase()}_`);
  });

// HACK: word-boundary aware to avoid false positives like `discount` /
// `account` matching "count" or `strength` matching "length". The hint
// must be either the entire identifier OR appear at the end with a
// case/underscore boundary (`userCount`, `user_count`, `USER_COUNT`).
const isNumericName = (name: string): boolean => {
  if (startsWithBooleanPrefix(name)) return false;
  for (const hint of NUMERIC_NAME_HINTS) {
    if (name === hint) return true;
    const camelSuffix = hint.charAt(0).toUpperCase() + hint.slice(1);
    if (name.endsWith(camelSuffix)) return true;
    if (name.endsWith(`_${hint}`)) return true;
    if (name.endsWith(`_${hint.toUpperCase()}`)) return true;
  }
  return false;
};

export const renderingConditionalRender = defineRule({
  id: "rendering-conditional-render",
  title: "Number before && renders stray 0",
  severity: "warn",
  recommendation:
    "Use `{items.length > 0 && <List />}`, or a ternary like `{items.length ? <List /> : null}`.",
  create: (context: RuleContext) => ({
    LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
      if (node.operator !== "&&") return;

      const isRightJsx =
        isNodeOfType(node.right, "JSXElement") || isNodeOfType(node.right, "JSXFragment");
      if (!isRightJsx) return;

      const left = node.left;
      if (!left) return;

      const isLengthMemberAccess =
        isNodeOfType(left, "MemberExpression") &&
        isNodeOfType(left.property, "Identifier") &&
        left.property.name === "length";

      const isNumericIdentifier = isNodeOfType(left, "Identifier") && isNumericName(left.name);

      if (isLengthMemberAccess || isNumericIdentifier) {
        context.report({
          node,
          message:
            "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
        });
      }
    },
  }),
});
