import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const NUMERIC_NAME_HINTS = [
  "count",
  "length",
  "total",
  "size",
  "num",
  "index",
  "amount",
  "quantity",
  "offset",
  "width",
  "height",
  "duration",
  "progress",
  "score",
  "rank",
  "level",
  "step",
  "max",
  "min",
  "sum",
  "avg",
  "depth",
  "balance",
  "age",
  "weight",
  "volume",
  "distance",
  "speed",
  "rate",
  "ratio",
  "percent",
  "percentage",
];

const BOOLEAN_PREFIXES = [
  "is",
  "has",
  "can",
  "should",
  "did",
  "will",
  "show",
  "hide",
  "enable",
  "disable",
];

// HACK: word-boundary aware to avoid false positives like `discount`
// matching "count" or `isPage` matching "page".
const isNumericName = (name: string): boolean => {
  const lower = name.toLowerCase();
  for (const prefix of BOOLEAN_PREFIXES) {
    if (
      lower.startsWith(prefix) &&
      name.length > prefix.length &&
      name[prefix.length] === name[prefix.length].toUpperCase()
    ) {
      return false;
    }
  }

  for (const hint of NUMERIC_NAME_HINTS) {
    if (lower === hint) return true;
    const camelSuffix = hint.charAt(0).toUpperCase() + hint.slice(1);
    if (name.endsWith(camelSuffix)) return true;
    if (lower.endsWith(`_${hint}`)) return true;
  }
  return false;
};

const isLikelyNumericExpression = (node: EsTreeNode): boolean => {
  if (
    isNodeOfType(node, "MemberExpression") &&
    isNodeOfType(node.property, "Identifier") &&
    node.property.name === "length"
  )
    return true;

  if (isNodeOfType(node, "Identifier") && isNumericName(node.name)) return true;

  if (
    isNodeOfType(node, "MemberExpression") &&
    isNodeOfType(node.property, "Identifier") &&
    isNumericName(node.property.name)
  )
    return true;

  return false;
};

// HACK: `{count && <Component />}` renders the raw number `0` when
// `count` is 0. On React Native, rendering a bare number outside
// `<Text>` causes a hard production crash. This rule flags `&&`
// conditions that look like they could produce a numeric falsy value.
//
// We intentionally do NOT flag every `{x && <Y />}` — most are
// boolean state/props/constants that never produce `0`. We only
// flag identifiers/expressions with numeric-sounding names or
// `.length` access.
export const rnNoFalsyAndRender = defineRule<Rule>({
  id: "rn-no-falsy-and-render",
  title: "Numeric && renders bare zero",
  requires: ["react-native"],
  severity: "error",
  recommendation:
    "When the number is 0, this shows a bare `0` as text, which crashes on RN. Use `{value > 0 && <X />}`, `{Boolean(value) && <X />}`, or `{value ? <X /> : null}`.",
  create: (context: RuleContext) => {
    let isDomComponentFile = false;

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        isDomComponentFile = hasDirective(programNode, "use dom");
      },
      LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
        if (isDomComponentFile) return;
        if (node.operator !== "&&") return;

        const isRightJsx =
          isNodeOfType(node.right, "JSXElement") || isNodeOfType(node.right, "JSXFragment");
        if (!isRightJsx) return;

        const parent = node.parent;
        const isInsideJsx =
          isNodeOfType(parent, "JSXExpressionContainer") ||
          (isNodeOfType(parent, "LogicalExpression") && parent.operator === "&&");
        if (!isInsideJsx) return;

        const left = node.left;
        if (!left) return;

        if (!isLikelyNumericExpression(left)) return;

        context.report({
          node: left,
          message: "Your users hit a crash when this value is 0 & renders a bare `0` as text.",
        });
      },
    };
  },
});
