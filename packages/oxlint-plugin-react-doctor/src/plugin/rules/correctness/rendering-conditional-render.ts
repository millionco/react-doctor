import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { isBooleanResultExpression } from "../../utils/is-boolean-result-expression.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { someAst } from "../../utils/some-ast.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
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

const isStringReturnValue = (value: EsTreeNode | null): boolean =>
  isNodeOfType(value, "TemplateLiteral") ||
  (isNodeOfType(value, "Literal") && typeof value.value === "string");

const isClosedLocalStringCall = (initializer: EsTreeNode | null, context: RuleContext): boolean => {
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.typeArguments ||
    !isNodeOfType(initializer.callee, "Identifier")
  ) {
    return false;
  }
  const { scopes } = context;
  const binding = scopes.symbolFor(initializer.callee);
  const formatter = binding?.declarationNode;
  if (
    !binding ||
    !isNodeOfType(formatter, "FunctionDeclaration") ||
    formatter.async ||
    formatter.generator ||
    formatter.typeParameters ||
    !isNodeOfType(formatter.parent, "Program") ||
    formatter.parent.sourceType !== "module" ||
    binding.scope.symbols.some((other) => other !== binding && other.name === binding.name)
  ) {
    return false;
  }
  const program = formatter.parent;
  const innerBinding = scopes.ownScopeFor(formatter)?.symbolsByName.get(binding.name);
  if (
    !innerBinding ||
    innerBinding.declarationNode !== formatter ||
    ![binding, innerBinding].every(
      (symbol) =>
        hasCompleteSymbolReferences(symbol, program, scopes) &&
        symbol.references.every(
          ({ flag, identifier }) =>
            flag === "read" &&
            isNodeOfType(identifier.parent, "CallExpression") &&
            identifier.parent.callee === identifier &&
            !identifier.parent.optional,
        ),
    )
  ) {
    return false;
  }

  // Direct eval can rebind a module-local function without an AST reference.
  if (
    someAst(program, (node) => {
      if (!isNodeOfType(node, "CallExpression")) return false;
      const callee = stripParenExpression(node.callee);
      return isNodeOfType(callee, "Identifier") && callee.name === "eval";
    })
  ) {
    return false;
  }

  const returns = collectFunctionReturnStatements(formatter).map(({ argument }) => argument);
  return (
    returns.some(isStringReturnValue) &&
    returns.every(
      (argument) =>
        !argument ||
        isStringReturnValue(argument) ||
        (isNodeOfType(argument, "Identifier") &&
          argument.name === "undefined" &&
          scopes.isGlobalReference(argument)),
    )
  );
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
      if (isNumericIdentifier) {
        const symbol = context.scopes.symbolFor(left);
        const initializer = symbol ? getDirectConstInitializer(symbol) : null;
        if (
          isBooleanResultExpression(initializer) ||
          isClosedLocalStringCall(initializer, context)
        ) {
          return;
        }
      }

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
