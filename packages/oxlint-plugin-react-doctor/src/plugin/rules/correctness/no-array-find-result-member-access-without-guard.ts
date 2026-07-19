import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "../../utils/strip-paren-expression.js";
import { unwrapNegativeGuardForm } from "../../utils/unwrap-negative-guard-form.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const MESSAGE =
  "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.";

const FIND_METHOD_NAMES = new Set(["find", "findLast"]);
// A PascalCase identifier names a class / model / component, never array data.
// It rules out `User.find(...)` (an ORM static) as a RECEIVER and
// `wrapper.find(Component)` (an enzyme/RTL component-selector query) as the
// ARGUMENT — neither result is an array element that can be `undefined`.
const PASCAL_CASE_IDENTIFIER_PATTERN = /^[A-Z]/;
// Capitalized globals that are real element predicates (`values.find(Boolean)`),
// not component selectors — exempt from the PascalCase argument bail.
const KNOWN_GLOBAL_PREDICATE_NAMES = new Set(["Boolean"]);
// `ParenthesizedExpression` is a real runtime node but is absent from the
// TSESTree type union, so it is matched via a string set rather than
// `isNodeOfType`.
const GROUPING_EXPRESSION_TYPES = new Set<string>(["ParenthesizedExpression"]);
const FUNCTION_NODE_TYPES = new Set<string>([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);
// `optional` is ignored so the `?.` spelling of a guard proves the plain
// spelling of the deref: `apps?.find(f)?.name && <span>{apps.find(f).name}
// </span>` — the truthy guard already proves both the receiver and the hit.
const STRUCTURAL_IDENTITY_IGNORED_KEYS = new Set([
  "parent",
  "loc",
  "range",
  "start",
  "end",
  "optional",
]);

// A callback-shaped first argument distinguishes `Array.prototype.find` from
// ORM query builders like `Model.find({ where: ... })` (an ObjectExpression
// argument, a hydrated row result) and from enzyme/RTL `wrapper.find(Component)`
// component-selector queries (a PascalCase identifier argument, a wrapper
// result), whose `.instance()`/`.first()`/`.props()` chains must stay quiet.
const hasArrayCallbackFirstArgument = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const rawFirstArgument = node.arguments?.[0];
  const firstArgument = rawFirstArgument
    ? stripParenExpression(rawFirstArgument as EsTreeNode)
    : null;
  if (!firstArgument) return false;
  if (
    isNodeOfType(firstArgument, "ArrowFunctionExpression") ||
    isNodeOfType(firstArgument, "FunctionExpression")
  ) {
    return true;
  }
  // A bare identifier is a predicate reference (`items.find(isActive)`), unless
  // it is PascalCase — a component selector (`wrapper.find(Modal)`), not a
  // predicate — except for known global predicates like `Boolean`. An
  // identifier that resolves to an object literal is a query filter
  // (`collection.find(filter)`, a MongoDB cursor), not a callback.
  if (isNodeOfType(firstArgument, "MemberExpression")) {
    const callee = stripParenExpression(node.callee as EsTreeNode);
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    const receiver = stripParenExpression(callee.object as EsTreeNode);
    if (isNodeOfType(receiver, "ArrayExpression")) return true;
    if (!isNodeOfType(receiver, "Identifier")) return false;
    const binding = findVariableInitializer(receiver, receiver.name);
    const initializer = binding?.initializer ? stripParenExpression(binding.initializer) : null;
    return Boolean(initializer && isNodeOfType(initializer, "ArrayExpression"));
  }
  if (!isNodeOfType(firstArgument, "Identifier")) return false;
  if (
    KNOWN_GLOBAL_PREDICATE_NAMES.has(firstArgument.name) &&
    context.scopes.isGlobalReference(firstArgument)
  ) {
    return true;
  }
  if (PASCAL_CASE_IDENTIFIER_PATTERN.test(firstArgument.name)) return false;
  const binding = findVariableInitializer(firstArgument, firstArgument.name);
  const initializer = binding?.initializer ? stripParenExpression(binding.initializer) : null;
  return !(initializer && isNodeOfType(initializer, "ObjectExpression"));
};

const hasInlineArrayCallbackFirstArgument = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const firstArgument = node.arguments?.[0];
  if (!firstArgument) return false;
  const callback = stripParenExpression(firstArgument as EsTreeNode);
  return (
    isNodeOfType(callback, "ArrowFunctionExpression") ||
    isNodeOfType(callback, "FunctionExpression")
  );
};

// `_.chain(users).filter(...).find(cb)` returns a LodashWrapper (unwrapped
// later by `.value()`), never `undefined` — a `.find` whose receiver chain
// roots in a `chain(...)` call is not Array.prototype.find.
const receiverChainContainsChainCall = (receiver: EsTreeNode): boolean => {
  let current = stripParenExpression(receiver);
  while (isNodeOfType(current, "CallExpression")) {
    const callee = stripParenExpression(current.callee as EsTreeNode);
    if (isNodeOfType(callee, "Identifier") && callee.name === "chain") return true;
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    if (isNodeOfType(callee.property, "Identifier") && callee.property.name === "chain") {
      return true;
    }
    current = stripParenExpression(callee.object as EsTreeNode);
  }
  return false;
};

// `[override, stored, "ltr"].find(Boolean)` over an array literal with a
// guaranteed-truthy literal element can never miss.
const isTruthyLiteralElement = (element: EsTreeNode | null): boolean => {
  if (!element) return false;
  const expression = stripParenExpression(element);
  if (isNodeOfType(expression, "Literal")) return Boolean(expression.value);
  if (isNodeOfType(expression, "TemplateLiteral")) {
    return expression.expressions.length === 0 && (expression.quasis[0]?.value?.raw ?? "") !== "";
  }
  return false;
};

const isBooleanFindOverTruthyArrayLiteral = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  if (!isNodeOfType(receiver, "ArrayExpression")) return false;
  const predicate = node.arguments?.[0];
  if (!predicate || !isNodeOfType(predicate, "Identifier") || predicate.name !== "Boolean") {
    return false;
  }
  return receiver.elements.some((element) => isTruthyLiteralElement(element as EsTreeNode | null));
};

const isArrayFindCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!FIND_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")) return false;
  // `User.find(...)` / `Model.find(...)`: a capitalized receiver is a
  // class/model static method, not an array instance method.
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  if (isNodeOfType(receiver, "Identifier") && PASCAL_CASE_IDENTIFIER_PATTERN.test(receiver.name)) {
    return false;
  }
  let resolvedReceiver = receiver;
  if (isNodeOfType(receiver, "Identifier")) {
    const visitedSymbolIds = new Set<number>();
    while (isNodeOfType(resolvedReceiver, "Identifier")) {
      const symbol = context.scopes.symbolFor(resolvedReceiver);
      if (!symbol || visitedSymbolIds.has(symbol.id) || !symbol.initializer) break;
      visitedSymbolIds.add(symbol.id);
      resolvedReceiver = stripParenExpression(symbol.initializer);
    }
    if (isNodeOfType(resolvedReceiver, "ObjectExpression")) return false;
  }
  if (receiverChainContainsChainCall(receiver)) return false;
  const resultMember = node.parent;
  if (
    isNodeOfType(resultMember, "MemberExpression") &&
    getStaticPropertyName(resultMember) === "exec" &&
    isNodeOfType(resultMember.parent, "CallExpression") &&
    resultMember.parent.callee === resultMember &&
    !isNodeOfType(resolvedReceiver, "ArrayExpression") &&
    !hasInlineArrayCallbackFirstArgument(node)
  ) {
    return false;
  }
  return hasArrayCallbackFirstArgument(node, context);
};

const areNodesStructurallyIdentical = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => areNodesStructurallyIdentical(item, right[index]))
    );
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  const leftEntries = Object.entries(left).filter(
    ([key]) => !STRUCTURAL_IDENTITY_IGNORED_KEYS.has(key),
  );
  const rightEntries = new Map(
    Object.entries(right).filter(([key]) => !STRUCTURAL_IDENTITY_IGNORED_KEYS.has(key)),
  );
  if (leftEntries.length !== rightEntries.size) return false;
  return leftEntries.every(
    ([key, value]) =>
      rightEntries.has(key) && areNodesStructurallyIdentical(value, rightEntries.get(key)),
  );
};

// `some(pred)` / `findIndex(pred)` over the same receiver with a structurally
// identical predicate proves a synchronous `find(pred)` cannot miss.
const EQUIVALENT_GUARD_METHOD_NAMES = new Set(["some", "findIndex"]);

// An inline function whose value sits directly in JSX (an event handler
// under a conditional render) only runs after that render committed, so a
// guard dominating the JSX position also dominates the closure body.
const isInlineJsxFunction = (functionNode: EsTreeNode): boolean => {
  let cursor = functionNode.parent ?? null;
  while (cursor && GROUPING_EXPRESSION_TYPES.has(cursor.type)) cursor = cursor.parent ?? null;
  return Boolean(
    cursor &&
    (isNodeOfType(cursor, "JSXExpressionContainer") || isNodeOfType(cursor, "JSXAttribute")),
  );
};

// `items.find(f) && items.find(f).x` / `items.find(f) ? items.find(f).x : y`
// / `if (items.find(f)) items.find(f).x` — the pre-ES2020 repeat-the-call
// guard idiom — plus every negated spelling of the same idiom (early
// return, else branch, ternary alternate after `!x` / `=== undefined`) and
// the `some(pred)`-before-`find(pred)` equivalence: the find expression is
// proven non-undefined before the dereference, so the access cannot throw.
const isGuardedByRepeatedFindTest = (findCall: EsTreeNodeOfType<"CallExpression">): boolean => {
  const findCallee = findCall.callee as EsTreeNodeOfType<"MemberExpression">;
  const isIdenticalFindCall = (candidate: EsTreeNode): boolean =>
    isNodeOfType(candidate, "CallExpression") && areNodesStructurallyIdentical(candidate, findCall);
  const isEquivalentPredicateGuard = (candidate: EsTreeNode): boolean => {
    if (!isNodeOfType(candidate, "CallExpression")) return false;
    const callee = candidate.callee;
    if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
    if (!isNodeOfType(callee.property, "Identifier")) return false;
    if (!EQUIVALENT_GUARD_METHOD_NAMES.has(callee.property.name)) return false;
    return (
      areNodesStructurallyIdentical(callee.object, findCallee.object) &&
      areNodesStructurallyIdentical(candidate.arguments?.[0], findCall.arguments?.[0])
    );
  };
  const predicateIsStable = (candidate: EsTreeNodeOfType<"CallExpression">): boolean => {
    const predicate = candidate.arguments?.[0];
    if (!predicate) return false;
    if (isNodeOfType(predicate, "Identifier") || isNodeOfType(predicate, "MemberExpression")) {
      return true;
    }
    let hasNestedCall = false;
    walkAst(predicate as EsTreeNode, (child) => {
      if (child !== predicate && FUNCTION_NODE_TYPES.has(child.type)) return false;
      if (isNodeOfType(child, "CallExpression")) {
        hasNestedCall = true;
        return false;
      }
    });
    return !hasNestedCall;
  };
  const asMatchingCall = (expression: EsTreeNode): EsTreeNodeOfType<"CallExpression"> | null => {
    const stripped = stripParenExpression(expression);
    if (!isNodeOfType(stripped, "CallExpression")) return null;
    if (!isIdenticalFindCall(stripped) && !isEquivalentPredicateGuard(stripped)) return null;
    return predicateIsStable(stripped) && predicateIsStable(findCall) ? stripped : null;
  };
  const isLiteralValue = (node: EsTreeNode, value: unknown): boolean => {
    const stripped = stripParenExpression(node);
    if (isNodeOfType(stripped, "Literal")) return stripped.value === value;
    if (
      value === -1 &&
      isNodeOfType(stripped, "UnaryExpression") &&
      stripped.operator === "-" &&
      isNodeOfType(stripped.argument, "Literal")
    ) {
      return stripped.argument.value === 1;
    }
    return (
      value === undefined && isNodeOfType(stripped, "Identifier") && stripped.name === "undefined"
    );
  };
  const optionalReadProvesFind = (test: EsTreeNode): boolean => {
    let expression = stripParenExpression(test);
    let hasOptionalRead = false;
    while (isNodeOfType(expression, "MemberExpression")) {
      hasOptionalRead ||= Boolean(expression.optional);
      expression = stripParenExpression(expression.object as EsTreeNode);
    }
    return (
      hasOptionalRead &&
      isNodeOfType(expression, "CallExpression") &&
      isIdenticalFindCall(expression) &&
      predicateIsStable(expression)
    );
  };
  const provesFind = (test: EsTreeNode): boolean => {
    const expression = stripParenExpression(test);
    const directCall = asMatchingCall(expression);
    if (directCall) {
      const callee = directCall.callee as EsTreeNodeOfType<"MemberExpression">;
      return getStaticPropertyName(callee) !== "findIndex";
    }
    if (optionalReadProvesFind(expression)) return true;
    if (isNodeOfType(expression, "LogicalExpression")) {
      if (expression.operator === "&&") {
        return (
          provesFind(expression.left as EsTreeNode) || provesFind(expression.right as EsTreeNode)
        );
      }
      if (expression.operator === "||") {
        return (
          provesFind(expression.left as EsTreeNode) && provesFind(expression.right as EsTreeNode)
        );
      }
      return false;
    }
    if (!isNodeOfType(expression, "BinaryExpression")) return false;
    const operandPairs: Array<[EsTreeNode, EsTreeNode]> = [
      [expression.left as EsTreeNode, expression.right as EsTreeNode],
      [expression.right as EsTreeNode, expression.left as EsTreeNode],
    ];
    for (const [candidate, comparisonValue] of operandPairs) {
      const matchingCall = asMatchingCall(candidate);
      if (!matchingCall) continue;
      const callee = matchingCall.callee as EsTreeNodeOfType<"MemberExpression">;
      const methodName = getStaticPropertyName(callee);
      if (methodName === "findIndex") {
        if (
          (expression.operator === "!==" || expression.operator === "!=") &&
          isLiteralValue(comparisonValue, -1)
        ) {
          return true;
        }
        if (
          (expression.operator === ">=" &&
            candidate === expression.left &&
            isLiteralValue(comparisonValue, 0)) ||
          (expression.operator === "<=" &&
            candidate === expression.right &&
            isLiteralValue(comparisonValue, 0))
        ) {
          return true;
        }
        continue;
      }
      if (methodName === "some") {
        if (
          (expression.operator === "===" || expression.operator === "==") &&
          isLiteralValue(comparisonValue, true)
        ) {
          return true;
        }
        if (
          (expression.operator === "!==" || expression.operator === "!=") &&
          isLiteralValue(comparisonValue, false)
        ) {
          return true;
        }
        continue;
      }
      if (
        (expression.operator === "!==" || expression.operator === "!=") &&
        (isLiteralValue(comparisonValue, null) || isLiteralValue(comparisonValue, undefined))
      ) {
        return true;
      }
    }
    return false;
  };

  let child: EsTreeNode = findCall;
  let ancestor: EsTreeNode | null = findCall.parent ?? null;
  while (ancestor) {
    if (FUNCTION_NODE_TYPES.has(ancestor.type) && !isInlineJsxFunction(ancestor)) return false;
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      ancestor.operator === "&&" &&
      ancestor.right === child &&
      provesFind(ancestor.left)
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "ConditionalExpression") || isNodeOfType(ancestor, "IfStatement")) {
      if (ancestor.consequent === child && provesFind(ancestor.test)) return true;
      if (ancestor.alternate === child) {
        const positiveGuard = unwrapNegativeGuardForm(ancestor.test);
        if (positiveGuard && provesFind(positiveGuard)) return true;
      }
    }
    if (isNodeOfType(ancestor, "BlockStatement")) {
      for (const statement of ancestor.body) {
        if (statement === child) break;
        if (
          isNodeOfType(statement, "IfStatement") &&
          !statement.alternate &&
          isEarlyExitStatement(statement.consequent)
        ) {
          const positiveGuard = unwrapNegativeGuardForm(statement.test);
          if (positiveGuard && provesFind(positiveGuard)) return true;
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

export const noArrayFindResultMemberAccessWithoutGuard = defineRule({
  id: "no-array-find-result-member-access-without-guard",
  title: "Unguarded member access on find() result",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "`Array.prototype.find`/`findLast` return `undefined` when no element matches, so guard the result with optional chaining (`?.`) or a null check before reading a property, indexing, or calling it.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isArrayFindCall(node, context)) return;

      let consumed: EsTreeNode = node;
      let consumer: EsTreeNode | null = node.parent ?? null;
      while (
        consumer &&
        TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(consumer.type) &&
        consumer.type !== "TSNonNullExpression"
      ) {
        consumed = consumer;
        consumer = consumer.parent ?? null;
      }
      if (!consumer) return;

      // An intervening `!` token (TSNonNullExpression) hands the finding to
      // the existing no-non-null-assertion rule, so only a bare, non-optional
      // property read/index/call on the result is reported here.
      const isUnguardedMemberRead =
        isNodeOfType(consumer, "MemberExpression") &&
        consumer.object === consumed &&
        !consumer.optional;
      const isUnguardedCall =
        isNodeOfType(consumer, "CallExpression") &&
        consumer.callee === consumed &&
        !consumer.optional;
      if (!isUnguardedMemberRead && !isUnguardedCall) return;
      if (isBooleanFindOverTruthyArrayLiteral(node)) return;
      if (isGuardedByRepeatedFindTest(node)) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
