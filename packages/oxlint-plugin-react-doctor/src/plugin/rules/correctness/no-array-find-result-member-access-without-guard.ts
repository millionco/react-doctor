import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { singleExpressionPredicateBody } from "../../utils/single-expression-predicate-body.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
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
const hasArrayCallbackFirstArgument = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const firstArgument = node.arguments?.[0];
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
  if (!isNodeOfType(firstArgument, "Identifier")) return false;
  if (KNOWN_GLOBAL_PREDICATE_NAMES.has(firstArgument.name)) return true;
  if (PASCAL_CASE_IDENTIFIER_PATTERN.test(firstArgument.name)) return false;
  const binding = findVariableInitializer(firstArgument, firstArgument.name);
  const initializer = binding?.initializer ? stripParenExpression(binding.initializer) : null;
  return !(initializer && isNodeOfType(initializer, "ObjectExpression"));
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

const isArrayFindCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (!FIND_METHOD_NAMES.has(callee.property.name)) return false;
  // `User.find(...)` / `Model.find(...)`: a capitalized receiver is a
  // class/model static method, not an array instance method.
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  if (isNodeOfType(receiver, "Identifier") && PASCAL_CASE_IDENTIFIER_PATTERN.test(receiver.name)) {
    return false;
  }
  if (receiverChainContainsChainCall(receiver)) return false;
  return hasArrayCallbackFirstArgument(node);
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

const subtreeContainsMatch = (
  root: EsTreeNode,
  matches: (node: EsTreeNode) => boolean,
): boolean => {
  let found = false;
  walkAst(root, (node) => {
    if (found) return false;
    if (matches(node)) {
      found = true;
      return false;
    }
  });
  return found;
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
  const provesFind = (test: EsTreeNode): boolean =>
    subtreeContainsMatch(
      test,
      (candidate) => isIdenticalFindCall(candidate) || isEquivalentPredicateGuard(candidate),
    );

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

// The `.map(...)` sibling may live in the same component OR in a same-file
// helper the component calls (`options={toOptionLabels(items)}`), so search
// the whole module when a Program root is reachable. Matches the map
// receiver either structurally (`props.items.map` / `this.props.options.map`)
// or by trailing identifier name (a helper's parameter re-names the array).
const enclosingScopeMapsOverReceiver = (
  findCall: EsTreeNodeOfType<"CallExpression">,
  findReceiver: EsTreeNode,
): boolean => {
  let outermostFunction: EsTreeNode | null = null;
  let programRoot: EsTreeNode | null = null;
  let current: EsTreeNode | null = findCall.parent ?? null;
  while (current) {
    if (FUNCTION_NODE_TYPES.has(current.type)) outermostFunction = current;
    if (isNodeOfType(current, "Program")) programRoot = current;
    current = current.parent ?? null;
  }
  const searchRoot = programRoot ?? outermostFunction;
  if (!searchRoot) return false;
  const receiverTrailingName = isNodeOfType(findReceiver, "Identifier")
    ? findReceiver.name
    : isNodeOfType(findReceiver, "MemberExpression") &&
        !findReceiver.computed &&
        isNodeOfType(findReceiver.property, "Identifier")
      ? findReceiver.property.name
      : null;
  return subtreeContainsMatch(searchRoot, (node) => {
    if (!isNodeOfType(node, "CallExpression")) return false;
    const callee = node.callee;
    if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
    if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "map") {
      return false;
    }
    if ((node.arguments?.length ?? 0) === 0) return false;
    const mapReceiver = stripParenExpression(callee.object as EsTreeNode);
    if (areNodesStructurallyIdentical(mapReceiver, findReceiver)) return true;
    return (
      receiverTrailingName !== null &&
      isNodeOfType(mapReceiver, "Identifier") &&
      mapReceiver.name === receiverTrailingName
    );
  });
};

// Self-derived equality lookup: `items.find((item) => item.key === value).prop`
// where the same `items` array is also `.map(...)`-ed in the enclosing
// function/component — the candidate values are drawn from the array being
// searched (`options={items.map((item) => item.label)}` feeding
// `onSelect`/`renderRow`), so the find cannot miss and a `?.` guard is dead
// code. Non-identity predicates (`s.confirmed === true`) and lookups without
// the sibling `.map` keep firing.
const isSelfDerivedEqualityLookup = (findCall: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = findCall.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  if (!isNodeOfType(receiver, "Identifier") && !isNodeOfType(receiver, "MemberExpression")) {
    return false;
  }
  const predicate = findCall.arguments?.[0];
  if (
    !isNodeOfType(predicate, "ArrowFunctionExpression") &&
    !isNodeOfType(predicate, "FunctionExpression")
  ) {
    return false;
  }
  const parameter = predicate.params?.[0];
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const predicateBody = singleExpressionPredicateBody(predicate);
  if (
    !predicateBody ||
    !isNodeOfType(predicateBody, "BinaryExpression") ||
    predicateBody.operator !== "==="
  ) {
    return false;
  }
  const leftSide = stripParenExpression(predicateBody.left as EsTreeNode);
  const rightSide = stripParenExpression(predicateBody.right as EsTreeNode);
  const sidePairs: Array<[EsTreeNode, EsTreeNode]> = [
    [leftSide, rightSide],
    [rightSide, leftSide],
  ];
  // The compared value may be a bare binding (`value`) or a member read
  // (`event.target.value`) — anything whose root is not the predicate's own
  // element parameter.
  const isEqualityLookupShape = sidePairs.some(([elementKeyRead, comparedValue]) => {
    if (
      !isNodeOfType(elementKeyRead, "MemberExpression") ||
      getRootIdentifierName(elementKeyRead) !== parameter.name
    ) {
      return false;
    }
    if (isNodeOfType(comparedValue, "Identifier")) return comparedValue.name !== parameter.name;
    return (
      isNodeOfType(comparedValue, "MemberExpression") &&
      getRootIdentifierName(comparedValue) !== parameter.name
    );
  });
  if (!isEqualityLookupShape) return false;
  return enclosingScopeMapsOverReceiver(findCall, receiver);
};

// Dotted receiver path tolerant of `?.` / `!` (`wishlist?.customerProductListItems`
// and `wishlist.customerProductListItems` compare equal); null for computed
// or non-Identifier-rooted shapes.
const optionalTolerantMemberPath = (node: EsTreeNode): string | null => {
  const target = stripParenExpression(node);
  if (isNodeOfType(target, "ChainExpression") || isNodeOfType(target, "TSNonNullExpression")) {
    return optionalTolerantMemberPath(target.expression as EsTreeNode);
  }
  if (isNodeOfType(target, "Identifier")) return target.name;
  if (
    isNodeOfType(target, "MemberExpression") &&
    !target.computed &&
    isNodeOfType(target.property, "Identifier")
  ) {
    const objectPath = optionalTolerantMemberPath(target.object as EsTreeNode);
    return objectPath === null ? null : `${objectPath}.${target.property.name}`;
  }
  return null;
};

// The element property an equality-lookup predicate keys on
// (`(i) => i.productId === product.productId` → "productId"); null when the
// predicate is not a single-expression `param.key === value` comparison.
const equalityLookupKeyName = (predicate: EsTreeNode | undefined): string | null => {
  if (
    !isNodeOfType(predicate, "ArrowFunctionExpression") &&
    !isNodeOfType(predicate, "FunctionExpression")
  ) {
    return null;
  }
  const parameter = predicate.params?.[0];
  if (!isNodeOfType(parameter, "Identifier")) return null;
  const predicateBody = singleExpressionPredicateBody(predicate);
  if (
    !predicateBody ||
    !isNodeOfType(predicateBody, "BinaryExpression") ||
    predicateBody.operator !== "==="
  ) {
    return null;
  }
  const sides = [
    stripParenExpression(predicateBody.left as EsTreeNode),
    stripParenExpression(predicateBody.right as EsTreeNode),
  ];
  for (const side of sides) {
    if (
      isNodeOfType(side, "MemberExpression") &&
      !side.computed &&
      isNodeOfType(side.property, "Identifier") &&
      isNodeOfType(stripParenExpression(side.object as EsTreeNode), "Identifier") &&
      getRootIdentifierName(side) === parameter.name
    ) {
      return side.property.name;
    }
  }
  return null;
};

// The candidate guard find's value is coerced to a boolean: under a `!`
// (`const isInWishlist = !!items?.find(...)`) or in a branch-test position.
const isBooleanConsumedExpression = (callNode: EsTreeNode): boolean => {
  let child: EsTreeNode = callNode;
  let parent = child.parent ?? null;
  while (parent) {
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") return true;
    if (
      isNodeOfType(parent, "ChainExpression") ||
      isNodeOfType(parent, "LogicalExpression") ||
      GROUPING_EXPRESSION_TYPES.has(parent.type)
    ) {
      child = parent;
      parent = parent.parent ?? null;
      continue;
    }
    if (
      isNodeOfType(parent, "IfStatement") ||
      isNodeOfType(parent, "ConditionalExpression") ||
      isNodeOfType(parent, "WhileStatement")
    ) {
      return (parent as { test?: EsTreeNode }).test === child;
    }
    return false;
  }
  return false;
};

// Derived-membership-state idiom: the module elsewhere boolean-tests a
// DIFFERENT find over the same receiver path keyed on the same element
// property (`const isInWishlist = !!wishlist?.customerProductListItems?.find(
// (item) => item.productId === productId)`), and that state gates the path
// that runs the unguarded deref (a favourite-toggle handler only invoked
// when the item is present). Structurally identical re-finds are excluded —
// those are decided by the domination-aware repeated-find guard, and a
// non-dominating identical test (a later-called closure) must keep firing.
const moduleDerivesMembershipStateFromSameLookup = (
  findCall: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const callee = findCall.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiverPath = optionalTolerantMemberPath(callee.object as EsTreeNode);
  if (!receiverPath || !receiverPath.includes(".")) return false;
  const keyName = equalityLookupKeyName(findCall.arguments?.[0]);
  if (!keyName) return false;
  let programRoot: EsTreeNode | null = null;
  let current: EsTreeNode | null = findCall.parent ?? null;
  while (current) {
    if (isNodeOfType(current, "Program")) programRoot = current;
    current = current.parent ?? null;
  }
  if (!programRoot) return false;
  return subtreeContainsMatch(programRoot, (node) => {
    if (node === findCall || !isNodeOfType(node, "CallExpression")) return false;
    if (areNodesStructurallyIdentical(node, findCall)) return false;
    const candidateCallee = node.callee;
    if (
      !isNodeOfType(candidateCallee, "MemberExpression") ||
      candidateCallee.computed ||
      !isNodeOfType(candidateCallee.property, "Identifier") ||
      !FIND_METHOD_NAMES.has(candidateCallee.property.name)
    ) {
      return false;
    }
    if (optionalTolerantMemberPath(candidateCallee.object as EsTreeNode) !== receiverPath) {
      return false;
    }
    if (equalityLookupKeyName(node.arguments?.[0]) !== keyName) return false;
    return isBooleanConsumedExpression(node);
  });
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
      if (!isArrayFindCall(node)) return;

      let consumed: EsTreeNode = node;
      let consumer: EsTreeNode | null = node.parent ?? null;
      while (consumer && GROUPING_EXPRESSION_TYPES.has(consumer.type)) {
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
      if (isSelfDerivedEqualityLookup(node)) return;
      if (moduleDerivesMembershipStateFromSameLookup(node)) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
