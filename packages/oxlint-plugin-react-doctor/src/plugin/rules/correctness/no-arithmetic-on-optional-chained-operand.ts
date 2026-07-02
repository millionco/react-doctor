import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const MESSAGE =
  "Multiplying or dividing an optional-chained value yields NaN when the chain short-circuits to undefined, and NaN spreads silently into formatting and comparisons. Add a `?? fallback` or guard the value before the math.";

const MULTIPLICATIVE_OPERATORS = new Set(["*", "/", "%"]);
const COMPARISON_OPERATORS = new Set(["<", ">", "<=", ">=", "==", "!=", "===", "!=="]);
const NUMERIC_FORMAT_METHOD_NAMES = new Set([
  "toFixed",
  "toString",
  "toPrecision",
  "toLocaleString",
]);
// `ParenthesizedExpression` is a real oxc runtime node absent from the
// TSESTree union, so it is matched by `.type` string rather than `isNodeOfType`.
const TRANSPARENT_WRAPPER_TYPES = new Set<string>([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

// Peels parens / TS wrappers but PRESERVES `ChainExpression`, because the
// whole rule turns on whether the operand is an optional chain (the shared
// `stripParenExpression` strips the chain wrapper and loses that signal).
const stripKeepingChain = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (
    current &&
    TRANSPARENT_WRAPPER_TYPES.has(current.type) &&
    "expression" in current &&
    current.expression
  ) {
    current = current.expression as EsTreeNode;
  }
  return current;
};

// The optional-chained MEMBER access when `node` is exactly `a?.b`
// (non-computed). Call forms (`a?.()`) and computed forms (`a?.[k]`) are
// intentionally excluded so the chained value is the direct arithmetic operand.
const asDirectOptionalChainMember = (
  node: EsTreeNode,
): EsTreeNodeOfType<"MemberExpression"> | null => {
  const stripped = stripKeepingChain(node);
  if (!isNodeOfType(stripped, "ChainExpression")) return null;
  const inner = stripped.expression as EsTreeNode;
  if (!isNodeOfType(inner, "MemberExpression")) return null;
  if (inner.computed) return null;
  return inner;
};

const optionalChainRootName = (memberExpression: EsTreeNode): string | null => {
  let current: EsTreeNode | null | undefined = memberExpression;
  while (current) {
    const stripped = stripKeepingChain(current);
    if (isNodeOfType(stripped, "ChainExpression")) {
      current = stripped.expression as EsTreeNode;
      continue;
    }
    if (isNodeOfType(stripped, "MemberExpression")) {
      current = stripped.object;
      continue;
    }
    if (isNodeOfType(stripped, "CallExpression")) {
      current = stripped.callee;
      continue;
    }
    if (isNodeOfType(stripped, "Identifier")) return stripped.name;
    return null;
  }
  return null;
};

// The names a guard may test to prove the operand can never be undefined:
// the chain root, plus the alias binding itself when the operand is an
// identifier bound to a chain (`const size = a?.b` — guarding `size` is just
// as sound as guarding `a`). A `??`/`||` fallback on the binding makes its
// initializer a LogicalExpression, so it naturally fails the chain check and
// is not treated as unguarded. Returns null when the operand is not an
// optional-chain value at all.
const resolveOptionalChainOperandGuardNames = (operand: EsTreeNode): string[] | null => {
  const direct = asDirectOptionalChainMember(operand);
  if (direct) {
    const rootName = optionalChainRootName(direct);
    return rootName ? [rootName] : null;
  }

  const stripped = stripKeepingChain(operand);
  if (!isNodeOfType(stripped, "Identifier")) return null;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding?.initializer) return null;
  const initializerMember = asDirectOptionalChainMember(binding.initializer);
  if (!initializerMember) return null;
  const rootName = optionalChainRootName(initializerMember);
  return rootName ? [rootName, stripped.name] : null;
};

const unwrapUpwards = (node: EsTreeNode): { consumed: EsTreeNode; consumer: EsTreeNode | null } => {
  let consumed = node;
  let consumer = node.parent ?? null;
  while (consumer && TRANSPARENT_WRAPPER_TYPES.has(consumer.type)) {
    consumed = consumer;
    consumer = consumer.parent ?? null;
  }
  return { consumed, consumer };
};

// The arithmetic result reaches a numeric consumer directly: `.toFixed()` etc.,
// a comparison, or a `Math.*` argument.
const isDirectNumericConsumer = (valueNode: EsTreeNode): boolean => {
  const { consumed, consumer } = unwrapUpwards(valueNode);
  if (!consumer) return false;
  if (
    isNodeOfType(consumer, "MemberExpression") &&
    consumer.object === consumed &&
    !consumer.computed &&
    isNodeOfType(consumer.property, "Identifier") &&
    NUMERIC_FORMAT_METHOD_NAMES.has(consumer.property.name)
  ) {
    return true;
  }
  if (
    isNodeOfType(consumer, "BinaryExpression") &&
    COMPARISON_OPERATORS.has(consumer.operator) &&
    (consumer.left === consumed || consumer.right === consumed)
  ) {
    return true;
  }
  if (
    isNodeOfType(consumer, "CallExpression") &&
    isNodeOfType(consumer.callee, "MemberExpression") &&
    isNodeOfType(consumer.callee.object, "Identifier") &&
    consumer.callee.object.name === "Math" &&
    (consumer.arguments ?? []).includes(consumed as never)
  ) {
    return true;
  }
  return false;
};

const findScopeOwner = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor) || isNodeOfType(ancestor, "Program")) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const NAN_CHECK_CALLEE_NAMES = new Set(["isNaN", "isFinite"]);

// The result binding is reassigned or NaN-checked (`if (Number.isNaN(ratio))
// ratio = 0;`) — the code already handles the failure the rule warns about,
// so the binding no longer flows unhandled into the numeric consumer.
const isNanHandledReference = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "AssignmentExpression") && parent.left === identifier) return true;
  if (
    isNodeOfType(parent, "CallExpression") &&
    (parent.arguments ?? []).some((argument) => argument === identifier)
  ) {
    const callee = stripKeepingChain(parent.callee);
    if (isNodeOfType(callee, "Identifier") && NAN_CHECK_CALLEE_NAMES.has(callee.name)) return true;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "Number" &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      NAN_CHECK_CALLEE_NAMES.has(callee.property.name)
    ) {
      return true;
    }
  }
  return false;
};

// A numeric consumer reached through an intermediate binding:
// `const share = a?.b / total; share.toFixed(2)`.
const flowsIntoNumericConsumerViaBinding = (binaryNode: EsTreeNode): boolean => {
  const { consumed, consumer } = unwrapUpwards(binaryNode);
  if (
    !consumer ||
    !isNodeOfType(consumer, "VariableDeclarator") ||
    consumer.init !== consumed ||
    !isNodeOfType(consumer.id, "Identifier")
  ) {
    return false;
  }
  const bindingName = consumer.id.name;
  const scopeOwner = findScopeOwner(binaryNode);
  if (!scopeOwner) return false;
  let reachesConsumer = false;
  let isNanHandled = false;
  walkAst(scopeOwner, (child: EsTreeNode) => {
    if (isNanHandled) return false;
    if (!isNodeOfType(child, "Identifier") || child.name !== bindingName || child === consumer.id) {
      return;
    }
    if (isNanHandledReference(child)) {
      isNanHandled = true;
      return false;
    }
    if (isDirectNumericConsumer(child)) reachesConsumer = true;
  });
  return reachesConsumer && !isNanHandled;
};

const isNumericConsumerContext = (binaryNode: EsTreeNode): boolean =>
  isDirectNumericConsumer(binaryNode) || flowsIntoNumericConsumerViaBinding(binaryNode);

const subtreeReferencesName = (node: EsTreeNode | null | undefined, name: string): boolean => {
  if (!node) return false;
  let found = false;
  walkAst(node, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "Identifier") && child.name === name) {
      const parent = child.parent;
      // A non-computed member property (`foo.<name>`) or an object property key
      // is not a reference to the guarded root binding.
      if (
        parent &&
        isNodeOfType(parent, "MemberExpression") &&
        parent.property === child &&
        !parent.computed
      ) {
        return;
      }
      found = true;
      return false;
    }
  });
  return found;
};

const subtreeReferencesAnyName = (
  node: EsTreeNode | null | undefined,
  guardNames: string[],
): boolean => guardNames.some((guardName) => subtreeReferencesName(node, guardName));

// The chain can never short-circuit because an enclosing `if`/ternary
// test or `&&`-guard already narrowed the chain root or its alias binding.
// The arithmetic must sit in the guarded BRANCH, not in the test itself
// (otherwise the test of `if (a?.b * n < x)` would suppress its own finding).
const isGuardedByEnclosingTest = (binaryNode: EsTreeNode, guardNames: string[]): boolean => {
  let child: EsTreeNode = binaryNode;
  let ancestor: EsTreeNode | null | undefined = binaryNode.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      (child === ancestor.consequent || child === ancestor.alternate) &&
      subtreeReferencesAnyName(ancestor.test, guardNames)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "ConditionalExpression") &&
      (child === ancestor.consequent || child === ancestor.alternate) &&
      subtreeReferencesAnyName(ancestor.test, guardNames)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      (ancestor.operator === "&&" || ancestor.operator === "||") &&
      child === ancestor.right &&
      subtreeReferencesAnyName(ancestor.left, guardNames)
    ) {
      return true;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// A preceding sibling `if (!x) return;`-style guard dominates the arithmetic
// just like an enclosing test does — the single most common React narrowing
// idiom (`if (!invoice) return null;` before the math).
const isGuardedByPrecedingEarlyExit = (binaryNode: EsTreeNode, guardNames: string[]): boolean => {
  let child: EsTreeNode = binaryNode;
  let ancestor: EsTreeNode | null | undefined = binaryNode.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const statements = ancestor.body;
      const childStatementIndex = statements.findIndex((statement) => statement === child);
      for (const precedingStatement of statements.slice(0, Math.max(childStatementIndex, 0))) {
        if (
          isNodeOfType(precedingStatement, "IfStatement") &&
          isEarlyExitStatement(precedingStatement.consequent) &&
          subtreeReferencesAnyName(precedingStatement.test, guardNames)
        ) {
          return true;
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// Flags `a?.b * n` / `a?.b / n` / `a?.b % n` (or a variable bound to `a?.b`)
// when the result flows into a numeric consumer and no `??` fallback or
// enclosing guard on the chain root exists. Additive operators, the
// `?.length - 1` index idiom, `?.()` call forms, and guarded roots stay quiet.
export const noArithmeticOnOptionalChainedOperand = defineRule({
  id: "no-arithmetic-on-optional-chained-operand",
  title: "Multiplicative math on optional-chained value can be NaN",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "An optional chain is `undefined` when it short-circuits, so `*`/`/`/`%` on it produces `NaN`, which silently corrupts formatting and comparisons. Provide a `?? fallback` or guard the chain root before the arithmetic.",
  create: (context: RuleContext) => ({
    BinaryExpression(node: EsTreeNodeOfType<"BinaryExpression">) {
      if (!MULTIPLICATIVE_OPERATORS.has(node.operator)) return;
      const operands: EsTreeNode[] = [node.left as EsTreeNode, node.right as EsTreeNode];
      for (const operand of operands) {
        const guardNames = resolveOptionalChainOperandGuardNames(operand);
        if (!guardNames) continue;
        if (isGuardedByEnclosingTest(node as EsTreeNode, guardNames)) continue;
        if (isGuardedByPrecedingEarlyExit(node as EsTreeNode, guardNames)) continue;
        if (!isNumericConsumerContext(node as EsTreeNode)) continue;
        context.report({ node, message: MESSAGE });
        return;
      }
    },
  }),
});
