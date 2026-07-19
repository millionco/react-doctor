import { defineRule } from "../../utils/define-rule.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { TRANSPARENT_EXPRESSION_WRAPPER_TYPES } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

// `is*` / `has*` / `can*` / `should*` / `will*` followed by an uppercase
// letter or digit. The lowercase-prefix requirement excludes PascalCase
// component/existence checks like `if (LazyComponent)`.
const PREDICATE_NAME_PATTERN = /^(is|has|can|should|will)[A-Z0-9]/;

// `ParenthesizedExpression` is a real runtime node but is absent from the
// TSESTree type union, so it is matched via a string set.
// Control-flow positions that coerce their operand to a boolean. A
// same-file zero-argument function reference in any of these is always
// truthy, so the guarded logic never runs.
const isInBooleanContext = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type)) return isInBooleanContext(parent);
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
  if (isNodeOfType(parent, "LogicalExpression")) {
    // The left operand of `&&` is always boolean-coerced — a truthy
    // function reference there makes `{isLoading && <Spinner/>}` render
    // unconditionally. `||` operands (and `&&` right operands) are only
    // real conditions when the whole logical expression is, which keeps
    // value-selection shapes like `customHandler || defaultHandler` quiet.
    if (parent.operator === "&&" && parent.left === node) return true;
    if (parent.operator !== "&&" && parent.operator !== "||") return false;
    return isInBooleanContext(parent);
  }
  return false;
};

// "Always truthy" is only sound when the initializer is the binding's one
// unconditional value. A parameter/destructuring DEFAULT (`{ isOpen = () =>
// false }`) only applies when the caller passes undefined, so the guard is
// legitimate.
const isDeclaredAsDirectInitializer = (binding: BindingInfo): boolean => {
  const declarationSite = binding.bindingIdentifier.parent;
  if (!declarationSite) return false;
  if (declarationSite === binding.initializer) {
    return (
      isNodeOfType(declarationSite, "FunctionDeclaration") ||
      isNodeOfType(declarationSite, "FunctionExpression")
    );
  }
  return (
    isNodeOfType(declarationSite, "VariableDeclarator") &&
    declarationSite.init === binding.initializer
  );
};

const CONDITIONAL_EXECUTION_ANCESTOR_TYPES = new Set<string>([
  "IfStatement",
  "ConditionalExpression",
  "LogicalExpression",
  "SwitchStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "TryStatement",
  "CatchClause",
]);

// A hoisted `var` (or Annex-B block function) assigned only inside a
// conditional block is `undefined` on paths where the block did not run,
// making a later existence check a real guard.
const isInitializerExecutedUnconditionally = (binding: BindingInfo): boolean => {
  let ancestor = binding.bindingIdentifier.parent ?? null;
  while (ancestor && ancestor !== binding.scopeOwner) {
    if (CONDITIONAL_EXECUTION_ANCESTOR_TYPES.has(ancestor.type)) return false;
    ancestor = ancestor.parent ?? null;
  }
  return true;
};

const resolvesToLocalFunction = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  const initializer = binding?.initializer;
  if (!binding || !initializer) return false;
  if (isNodeOfType(initializer, "Identifier")) {
    if (initializer.name === "Boolean" && context.scopes.isGlobalReference(initializer))
      return true;
    const symbol = context.scopes.symbolFor(initializer);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    return resolvesToLocalFunction(initializer, context, visitedSymbolIds);
  }
  if (
    !isNodeOfType(initializer, "FunctionDeclaration") &&
    !isNodeOfType(initializer, "FunctionExpression") &&
    !isNodeOfType(initializer, "ArrowFunctionExpression")
  ) {
    return false;
  }
  if (!isDeclaredAsDirectInitializer(binding)) return false;
  return isInitializerExecutedUnconditionally(binding);
};

const hasRelevantWrite = (symbol: SymbolDescriptor, referenceNode: EsTreeNode): boolean => {
  const referenceFunction = findEnclosingFunction(referenceNode);
  return symbol.references.some((reference) => {
    if (reference.flag === "read") return false;
    const writeFunction = findEnclosingFunction(reference.identifier);
    return (
      writeFunction !== referenceFunction || reference.identifier.range[0] < referenceNode.range[0]
    );
  });
};

const containsReferenceOf = (
  root: EsTreeNode,
  symbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  let didFindReference = false;
  walkAst(root, (node) => {
    if (didFindReference) return false;
    if (!isNodeOfType(node, "Identifier") || context.scopes.symbolFor(node)?.id !== symbol.id) {
      return;
    }
    const parent = node.parent;
    // Property-name and object-key positions reuse the name without
    // reading the binding.
    if (
      parent &&
      isNodeOfType(parent, "MemberExpression") &&
      parent.property === node &&
      !parent.computed
    ) {
      return;
    }
    if (parent && isNodeOfType(parent, "Property") && parent.key === node && !parent.computed) {
      return;
    }
    didFindReference = true;
    return false;
  });
  return didFindReference;
};

// `if (isPolling) { isPolling(); }` / `isPolling && isPolling()` /
// `if (isSessionValid) { guards.push(isSessionValid); }` /
// `isRowSelectable ? isRowSelectable : undefined` — a deliberate existence
// guard whose branch evaluates OR hands out the very reference it tested,
// so "the check never runs" would be wrong.
const isExistenceGuardOverUsedReference = (
  identifier: EsTreeNodeOfType<"Identifier">,
  symbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  let current: EsTreeNode = identifier;
  let parent = current.parent ?? null;
  while (parent) {
    if (TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type)) {
      current = parent;
      parent = parent.parent ?? null;
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.operator === "&&") {
      if (parent.left === current && containsReferenceOf(parent.right, symbol, context)) {
        return true;
      }
      current = parent;
      parent = parent.parent ?? null;
      continue;
    }
    break;
  }
  if (!parent) return false;
  // A negated test (`if (!isX) { fallback } else { isX() }`,
  // `!isX ? fallback : isX() ? a : b`) puts the evaluation/use in the
  // ALTERNATE — credit both branches, matching the mention-not-polarity
  // stance of the other guard checks.
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") {
    current = parent;
    parent = parent.parent ?? null;
    if (!parent) return false;
  }
  if (
    (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) &&
    parent.test === current
  ) {
    if (containsReferenceOf(parent.consequent, symbol, context)) return true;
    return Boolean(
      parent.alternate && containsReferenceOf(parent.alternate as EsTreeNode, symbol, context),
    );
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
      if (!resolvesToLocalFunction(node, context)) return;
      const symbol = context.scopes.symbolFor(node);
      if (!symbol || hasRelevantWrite(symbol, node)) return;
      if (isExistenceGuardOverUsedReference(node, symbol, context)) return;
      context.report({
        node,
        message: `This condition is always true because \`${node.name}\` is a function reference, not its result, so the check never runs — call it as \`${node.name}()\` to evaluate the predicate.`,
      });
    },
  }),
});
