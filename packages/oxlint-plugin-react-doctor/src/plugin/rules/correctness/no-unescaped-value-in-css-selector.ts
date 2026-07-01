import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This splices a runtime value into a CSS attribute/id selector without `CSS.escape`, so a value carrying a quote or other metacharacter closes the selector early: `querySelector`/`matches`/`closest` then throws a SyntaxError or silently matches the wrong node. Wrap the value in `CSS.escape(...)`.";

const QUERY_METHOD_NAMES = new Set(["querySelector", "querySelectorAll", "matches", "closest"]);

// Common numeric loop/index names. A numeric substitution can never carry a
// CSS metacharacter, so escaping it is pure noise (the dominant FP class).
const NUMERIC_VARIABLE_NAMES = new Set(["index", "i", "idx", "col", "row", "colIndex", "rowIndex"]);

// The preceding quasi puts the substitution inside an attribute VALUE
// (`[attr='` / `[attr="`) or an id selector (`#`) — the only positions where a
// stray metacharacter breaks the selector. Attribute-NAME position (`[` with
// no `='`) is excluded, matching the compile-time-constant-name FP.
const substitutionSitsInAttributeValueOrId = (precedingRaw: string): boolean =>
  /\[[^\]]*=\s*['"]$/.test(precedingRaw) || /#$/.test(precedingRaw);

const isNumericNamed = (name: string): boolean => NUMERIC_VARIABLE_NAMES.has(name);

// A runtime string substitution: a plain identifier or member read whose name
// is not a known-numeric index. Numeric literals, calls (including
// `CSS.escape(...)` and `id.replace(...)`), and template literals are excluded.
const isRuntimeStringSubstitution = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "Identifier")) return !isNumericNamed(expression.name);
  if (isNodeOfType(expression, "MemberExpression")) {
    if (
      isNodeOfType(expression.property, "Identifier") &&
      isNumericNamed(expression.property.name)
    ) {
      return false;
    }
    return true;
  }
  return false;
};

const findEnclosingDeclarator = (
  bindingIdentifier: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let cursor: EsTreeNode | null | undefined = bindingIdentifier.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "VariableDeclarator")) return cursor;
    if (isFunctionLike(cursor)) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

// The template literal a call argument evaluates to: either an inline template
// literal or an identifier bound to a `const` template-literal initializer.
const resolveSelectorTemplate = (
  argument: EsTreeNode,
): EsTreeNodeOfType<"TemplateLiteral"> | null => {
  const inner = stripParenExpression(argument);
  if (isNodeOfType(inner, "TemplateLiteral")) return inner;
  if (!isNodeOfType(inner, "Identifier")) return null;
  const binding = findVariableInitializer(inner, inner.name);
  if (!binding) return null;
  const declarator = findEnclosingDeclarator(binding.bindingIdentifier);
  if (!declarator || declarator.id !== binding.bindingIdentifier) return null;
  const init = declarator.init ? stripParenExpression(declarator.init as EsTreeNode) : null;
  return init && isNodeOfType(init, "TemplateLiteral") ? init : null;
};

const isQuerySelectorFamilyCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(node.callee as EsTreeNode);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    QUERY_METHOD_NAMES.has(callee.property.name)
  );
};

export const noUnescapedValueInCssSelector = defineRule({
  id: "no-unescaped-value-in-css-selector",
  title: "Unescaped runtime value in a CSS selector",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "Interpolating a runtime string into `[attr='...']` or `#...` and passing it to `querySelector`/`matches`/`closest` breaks the selector when the value contains a quote or metacharacter; wrap it in `CSS.escape(value)` so it stays a literal token.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isQuerySelectorFamilyCall(node)) return;
      const argument = node.arguments[0];
      if (!argument) return;
      const template = resolveSelectorTemplate(argument as EsTreeNode);
      if (!template) return;

      for (let index = 0; index < template.expressions.length; index++) {
        const quasi = template.quasis[index];
        const precedingRaw = quasi?.value?.raw ?? quasi?.value?.cooked ?? "";
        if (!substitutionSitsInAttributeValueOrId(precedingRaw)) continue;
        const expression = stripParenExpression(template.expressions[index] as EsTreeNode);
        if (!isRuntimeStringSubstitution(expression)) continue;
        context.report({ node: expression, message: MESSAGE });
      }
    },
  }),
});
