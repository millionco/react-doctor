import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// `is*` / `has*` / `can*` / `should*` / `will*` followed by an uppercase
// letter or digit. The lowercase-prefix requirement excludes PascalCase
// component/existence checks like `if (LazyComponent)`.
const PREDICATE_NAME_PATTERN = /^(is|has|can|should|will)[A-Z0-9]/;

// `ParenthesizedExpression` is a real runtime node but is absent from the
// TSESTree type union, so it is matched via a string set.
const GROUPING_EXPRESSION_TYPES = new Set<string>(["ParenthesizedExpression"]);

// Control-flow positions that coerce their operand to a boolean. A
// same-file zero-argument function reference in any of these is always
// truthy, so the guarded logic never runs.
const isInBooleanContext = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (GROUPING_EXPRESSION_TYPES.has(parent.type))
    return isInBooleanContext(parent);
  if (isNodeOfType(parent, "UnaryExpression")) {
    return parent.operator === "!" && parent.argument === node;
  }
  if (
    isNodeOfType(parent, "IfStatement") ||
    isNodeOfType(parent, "WhileStatement") ||
    isNodeOfType(parent, "DoWhileStatement") ||
    isNodeOfType(parent, "ForStatement")
  ) {
    return parent.test === node;
  }
  if (isNodeOfType(parent, "ConditionalExpression")) {
    return parent.test === node;
  }
  // A `&&` / `||` operand is only a real condition when the whole logical
  // expression is itself in a boolean context — this keeps value-selection
  // shapes like `const handler = customHandler || defaultHandler` quiet.
  if (isNodeOfType(parent, "LogicalExpression")) {
    if (parent.operator !== "&&" && parent.operator !== "||") return false;
    return isInBooleanContext(parent);
  }
  return false;
};

const resolvesToZeroArgumentFunction = (
  identifier: EsTreeNodeOfType<"Identifier">
): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  const initializer = binding?.initializer;
  if (!initializer) return false;
  if (
    isNodeOfType(initializer, "FunctionDeclaration") ||
    isNodeOfType(initializer, "FunctionExpression") ||
    isNodeOfType(initializer, "ArrowFunctionExpression")
  ) {
    return Array.isArray(initializer.params) && initializer.params.length === 0;
  }
  return false;
};

export const noPredicateFunctionReferenceInBooleanPosition = defineRule({
  id: "no-predicate-function-reference-in-boolean-position",
  title: "Predicate function used without calling it",
  severity: "warn",
  recommendation:
    "A bare `is*`/`has*`/`can*`/`should*`/`will*` function reference is always truthy in a condition, so the guarded branch never behaves as intended. Call the function (`isReady()`) to evaluate the predicate.",
  create: (context: RuleContext) => ({
    Identifier(node: EsTreeNodeOfType<"Identifier">) {
      if (!PREDICATE_NAME_PATTERN.test(node.name)) return;
      if (!isInBooleanContext(node)) return;
      if (!resolvesToZeroArgumentFunction(node)) return;
      context.report({
        node,
        message: `This condition is always true because \`${node.name}\` is a function reference, not its result, so the check never runs — call it as \`${node.name}()\` to evaluate the predicate.`,
      });
    },
  }),
});
