import { defineRule } from "../../utils/define-rule.js";
import { HTML_TAGS } from "../../constants/html-tags.js";
import { SVG_TAGS } from "../../constants/svg-tags.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isConstDeclaredBinding } from "../../utils/is-const-declared-binding.js";
import { hasDirective } from "../../utils/has-directive.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isJsxFragmentElement } from "../../utils/is-jsx-fragment-element.js";

const COMPARISON_OPERATORS = new Set(["===", "!==", "==", "!=", "<", "<=", ">", ">="]);

// An expression that always evaluates to a boolean — never the numeric `0`
// that crashes when rendered bare. `{flag && <X/>}` on such a value is safe.
const isBooleanExpression = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Literal") && typeof node.value === "boolean") return true;
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "!") return true;
  if (isNodeOfType(node, "BinaryExpression") && COMPARISON_OPERATORS.has(node.operator))
    return true;
  if (isNodeOfType(node, "CallExpression") && isNodeOfType(node.callee, "Identifier")) {
    return node.callee.name === "Boolean";
  }
  return false;
};

const isUseStateCall = (
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") && isHookCall(node, "useState");

const findEnclosingScope = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "FunctionDeclaration") ||
      isNodeOfType(ancestor, "FunctionExpression") ||
      isNodeOfType(ancestor, "ArrowFunctionExpression") ||
      isNodeOfType(ancestor, "Program")
    ) {
      return ancestor;
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// `const [open, setOpen] = useState(false)` — array-destructured state isn't
// reachable through findVariableInitializer, so scan the enclosing scope for a
// `useState(<boolean>)` whose first destructured binding is `name`.
const isBooleanUseStateName = (referenceNode: EsTreeNode, name: string): boolean => {
  const scope = findEnclosingScope(referenceNode);
  if (!scope) return false;
  let isBooleanState = false;
  walkAst(scope, (child: EsTreeNode) => {
    if (isBooleanState) return;
    // A `useState` declared inside a NESTED function belongs to that scope, not
    // the reference's — don't let an inner `useState(false)` of the same name
    // mask an outer `useState(0)`. Don't descend into nested function scopes.
    if (
      child !== scope &&
      (isNodeOfType(child, "FunctionDeclaration") ||
        isNodeOfType(child, "FunctionExpression") ||
        isNodeOfType(child, "ArrowFunctionExpression"))
    ) {
      return false;
    }
    if (!isNodeOfType(child, "VariableDeclarator")) return;
    if (!isNodeOfType(child.id, "ArrayPattern")) return;
    const firstBinding = child.id.elements?.[0];
    if (!firstBinding || !isNodeOfType(firstBinding, "Identifier") || firstBinding.name !== name) {
      return;
    }
    if (isUseStateCall(child.init) && isBooleanExpression(child.init.arguments?.[0])) {
      isBooleanState = true;
    }
  });
  return isBooleanState;
};

// A literal initializer that is always truthy, so `{value && <X/>}` can never
// render a bare `0`: a non-zero numeric literal or a non-empty string literal.
const isProvablyTruthyLiteral = (node: EsTreeNode | null | undefined): boolean => {
  if (!node || !isNodeOfType(node, "Literal")) return false;
  if (typeof node.value === "number") return node.value !== 0;
  if (typeof node.value === "string") return node.value.length > 0;
  return false;
};

// True when `identifier` provably holds a never-bare-`0` value: a boolean
// initializer, boolean `useState`, or a constant truthy literal (non-zero
// number / non-empty string). The declaration-time initializer only proves
// anything for a `const` binding — a `let` / `var` can be reassigned to a
// bare `0` after declaration (`let count = 5; count = items.length;`).
const isProvablyBooleanIdentifier = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (isConstDeclaredBinding(binding)) {
    if (isBooleanExpression(binding?.initializer)) return true;
    if (isProvablyTruthyLiteral(binding?.initializer)) return true;
  }
  return isBooleanUseStateName(identifier, identifier.name);
};

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

const isRenderedInsideIntrinsicDomHost = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) {
      const isChildrenAttribute =
        isNodeOfType(ancestor.name, "JSXIdentifier") && ancestor.name.name === "children";
      if (!isChildrenAttribute) return false;
    }

    if (
      isNodeOfType(ancestor, "JSXElement") &&
      !isJsxFragmentElement(ancestor.openingElement, scopes)
    ) {
      const elementName = ancestor.openingElement.name;
      if (!isNodeOfType(elementName, "JSXIdentifier")) return false;
      return HTML_TAGS.has(elementName.name) || SVG_TAGS.has(elementName.name);
    }

    if (
      isNodeOfType(ancestor, "CallExpression") ||
      isNodeOfType(ancestor, "NewExpression") ||
      isNodeOfType(ancestor, "VariableDeclarator") ||
      isNodeOfType(ancestor, "AssignmentExpression") ||
      isNodeOfType(ancestor, "Property") ||
      isFunctionLike(ancestor) ||
      isNodeOfType(ancestor, "Program")
    ) {
      return false;
    }

    ancestor = ancestor.parent;
  }

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
export const rnNoFalsyAndRender = defineRule({
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
        if (isRenderedInsideIntrinsicDomHost(node, context.scopes)) return;

        const left = node.left;
        if (!left) return;

        if (!isLikelyNumericExpression(left)) return;
        // A numeric-sounding name that provably holds a boolean never renders a
        // bare `0`, so flagging it would be a false positive.
        if (isNodeOfType(left, "Identifier") && isProvablyBooleanIdentifier(left)) return;

        context.report({
          node: left,
          message: "Your users hit a crash when this value is 0 & renders a bare `0` as text.",
        });
      },
    };
  },
});
