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
// `==`/`===` are deliberately absent: `NaN === x` is false for every x, so an
// equality consumer degrades to the "no match" outcome — the same behavior as
// absent data — and the suggested `?? 0` fallback would wrongly make a
// `x % 4 === 0` flag true. Negated equality misbehaves the opposite way
// (`NaN !== x` is always true), so `!=`/`!==` still count.
const NAN_OBSERVING_COMPARISON_OPERATORS = new Set(["<", ">", "<=", ">=", "!=", "!=="]);
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

// Serializes `a?.b.c` to "a.b.c" (non-computed members only) so two chain
// expressions can be compared for identity.
const chainMemberPath = (memberExpression: EsTreeNode): string | null => {
  const propertyNames: string[] = [];
  let current: EsTreeNode = memberExpression;
  while (true) {
    const stripped = stripKeepingChain(current);
    if (isNodeOfType(stripped, "ChainExpression")) {
      current = stripped.expression as EsTreeNode;
      continue;
    }
    if (isNodeOfType(stripped, "MemberExpression")) {
      if (stripped.computed || !isNodeOfType(stripped.property, "Identifier")) return null;
      propertyNames.unshift(stripped.property.name);
      current = stripped.object;
      continue;
    }
    if (isNodeOfType(stripped, "Identifier")) {
      propertyNames.unshift(stripped.name);
      return propertyNames.join(".");
    }
    return null;
  }
};

// Same-scope bindings that alias the exact chain being multiplied
// (`const price = item?.price;` before `item?.price * 2`) — a guard on the
// alias narrows the chain just as soundly as a guard on the root. Only
// declarators whose OWN function scope encloses the arithmetic count: a
// same-named alias inside a sibling nested function is a different
// variable, and crediting its name would let an unrelated `if (price)`
// suppress real findings.
const collectSameChainAliasNames = (operandMember: EsTreeNode): string[] => {
  const operandPath = chainMemberPath(operandMember);
  if (!operandPath) return [];
  const scopeOwner = findScopeOwner(operandMember);
  if (!scopeOwner) return [];
  const aliasNames: string[] = [];
  walkAst(scopeOwner, (child: EsTreeNode) => {
    if (
      !isNodeOfType(child, "VariableDeclarator") ||
      !isNodeOfType(child.id, "Identifier") ||
      !child.init
    ) {
      return;
    }
    if (findScopeOwner(child) !== scopeOwner) return;
    const initializerMember = asDirectOptionalChainMember(child.init);
    if (initializerMember && chainMemberPath(initializerMember) === operandPath) {
      aliasNames.push(child.id.name);
    }
  });
  return aliasNames;
};

// The names a guard may test to prove the operand can never be undefined:
// the chain root, plus the alias binding itself when the operand is an
// identifier bound to a chain (`const size = a?.b` — guarding `size` is just
// as sound as guarding `a`), plus same-scope aliases of the identical chain
// when the operand re-derefs it (`const price = item?.price; if (!price)
// return; item?.price * 2`). A `??`/`||` fallback on the binding makes its
// initializer a LogicalExpression, so it naturally fails the chain check and
// is not treated as unguarded. Returns null when the operand is not an
// optional-chain value at all.
const resolveOptionalChainOperandGuardNames = (operand: EsTreeNode): string[] | null => {
  const direct = asDirectOptionalChainMember(operand);
  if (direct) {
    const rootName = optionalChainRootName(direct);
    return rootName ? [rootName, ...collectSameChainAliasNames(direct)] : null;
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

// Same-scope bindings derived from the SAME PARENT CHAIN as the operand —
// an identical path, a prefix of it, or a sibling leaf (`procTotal =
// health?.processes?.total` vs `procOnline = health?.processes?.online`).
// When such a binding is truthy the shared chain prefix resolved, so the
// operand's chain cannot short-circuit. Initializers with a `||`/`??`
// fallback qualify too (`const timeScore = details.time?.score || 1`) —
// the guard check is mention-level, matching the rule's existing
// precision. These names are credited ONLY for enclosing tests
// (`procTotal ? procOnline / procTotal : 0.25`), not for preceding
// early-exit guards: a distant `if (!label) return;` on a different leaf
// says nothing about the property being multiplied.
const chainAliasPathQualifiesForTest = (aliasPath: string, operandPath: string): boolean => {
  if (aliasPath === operandPath) return true;
  if (operandPath.startsWith(`${aliasPath}.`)) return true;
  const aliasParentEnd = aliasPath.lastIndexOf(".");
  const operandParentEnd = operandPath.lastIndexOf(".");
  return (
    aliasParentEnd > 0 &&
    operandParentEnd > 0 &&
    aliasPath.slice(0, aliasParentEnd) === operandPath.slice(0, operandParentEnd)
  );
};

const chainMemberOfAliasInitializer = (initializer: EsTreeNode): EsTreeNode | null => {
  const direct = asDirectOptionalChainMember(initializer);
  if (direct) return direct;
  const stripped = stripKeepingChain(initializer);
  if (
    isNodeOfType(stripped, "LogicalExpression") &&
    (stripped.operator === "||" || stripped.operator === "??")
  ) {
    return asDirectOptionalChainMember(stripped.left as EsTreeNode);
  }
  return null;
};

const collectSameParentChainAliasNames = (operandMember: EsTreeNode): string[] => {
  const operandPath = chainMemberPath(operandMember);
  if (!operandPath) return [];
  const scopeOwner = findScopeOwner(operandMember);
  if (!scopeOwner) return [];
  const aliasNames: string[] = [];
  walkAst(scopeOwner, (child: EsTreeNode) => {
    if (
      !isNodeOfType(child, "VariableDeclarator") ||
      !isNodeOfType(child.id, "Identifier") ||
      !child.init
    ) {
      return;
    }
    if (findScopeOwner(child) !== scopeOwner) return;
    const initializerMember = chainMemberOfAliasInitializer(child.init as EsTreeNode);
    if (!initializerMember) return;
    const aliasPath = chainMemberPath(initializerMember);
    if (aliasPath && chainAliasPathQualifiesForTest(aliasPath, operandPath)) {
      aliasNames.push(child.id.name);
    }
  });
  return aliasNames;
};

// The extra names an enclosing `if`/ternary/`&&` test may mention to prove
// the operand's chain resolved; empty when the operand is not chain-derived.
const resolveEnclosingTestOnlyGuardNames = (operand: EsTreeNode): string[] => {
  const direct = asDirectOptionalChainMember(operand);
  if (direct) return collectSameParentChainAliasNames(direct);
  const stripped = stripKeepingChain(operand);
  if (!isNodeOfType(stripped, "Identifier")) return [];
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding?.initializer) return [];
  const initializerMember = asDirectOptionalChainMember(binding.initializer);
  if (!initializerMember) return [];
  return collectSameParentChainAliasNames(initializerMember);
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

// A comparison sitting (through parens, `!`, and `&&`/`||` chains) in a
// branching TEST position is NaN-SAFE by construction — `NaN > 0` is false,
// so the guarded branch simply doesn't run. Only comparisons whose result is
// consumed as a value (a sort callback return, an assignment) spread NaN.
const BRANCH_TEST_PARENT_TYPES = new Set<string>([
  "IfStatement",
  "ConditionalExpression",
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
]);

const isComparisonInTestPosition = (comparisonNode: EsTreeNode): boolean => {
  let child: EsTreeNode = comparisonNode;
  let parent = child.parent ?? null;
  while (parent) {
    if (
      TRANSPARENT_WRAPPER_TYPES.has(parent.type) ||
      isNodeOfType(parent, "LogicalExpression") ||
      (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!")
    ) {
      child = parent;
      parent = parent.parent ?? null;
      continue;
    }
    if (isNodeOfType(parent, "JSXExpressionContainer")) return true;
    if (BRANCH_TEST_PARENT_TYPES.has(parent.type)) {
      return (parent as { test?: EsTreeNode }).test === child;
    }
    return false;
  }
  return false;
};

// The arithmetic result reaches a numeric consumer directly: `.toFixed()` etc.,
// a comparison, or a `Math.*` argument. `treatTestComparisonAsGuard` applies
// only on the binding-reference path: `if (discount > 0) { …discount… }`
// gates the RESULT's own consumers (a guard), while a direct
// `if (a?.b * f < t)` comparison IS the silent NaN misbehavior the rule
// exists to catch.
const isDirectNumericConsumer = (
  valueNode: EsTreeNode,
  treatTestComparisonAsGuard = false,
): boolean => {
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
    NAN_OBSERVING_COMPARISON_OPERATORS.has(consumer.operator) &&
    (consumer.left === consumed || consumer.right === consumed)
  ) {
    return treatTestComparisonAsGuard ? !isComparisonInTestPosition(consumer) : true;
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

// The result binding is plainly reassigned (a flow break — the consumer no
// longer reads the arithmetic result) or NaN-checked (`if (Number.isNaN(ratio))
// ratio = 0;`). Compound assignments (`ratio *= 2`) keep NaN NaN, so only the
// `=` operator counts as a flow break.
const isNanHandledReference = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.operator === "=" &&
    parent.left === identifier
  ) {
    return true;
  }
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

// oxlint runtime nodes carry `range`; the oxc-parser test AST carries
// numeric `start` offsets instead — accept either.
const nodeStartOffset = (node: EsTreeNode): number => {
  if (node.range) return node.range[0];
  const nodeWithOffsets = node as { start?: number };
  return typeof nodeWithOffsets.start === "number"
    ? nodeWithOffsets.start
    : Number.MAX_SAFE_INTEGER;
};

// A same-named inner binding (shadowing parameter or nested declarator) is
// not a use of the arithmetic result — only identifiers that resolve back to
// the declarator's own id count.
const isReferenceToBinding = (
  referenceIdentifier: EsTreeNodeOfType<"Identifier">,
  bindingIdentifier: EsTreeNode,
): boolean =>
  findVariableInitializer(referenceIdentifier, referenceIdentifier.name)?.bindingIdentifier ===
  bindingIdentifier;

// A numeric consumer reached through an intermediate binding:
// `const share = a?.b / total; share.toFixed(2)`. Order-aware: a NaN check or
// plain reassignment suppresses only the consumers that come after it — a
// consumer that reads the binding first already received the NaN. Each
// consumer SITE is also checked against the guards individually: the
// hooks-before-early-returns ordering React forces ("derive first, guard
// second") puts the guard between the arithmetic and the consumer, and the
// RESULT binding itself is a valid guard subject because NaN is falsy
// (`if (!discount) return null;` catches the short-circuited case).
const flowsIntoNumericConsumerViaBinding = (
  binaryNode: EsTreeNode,
  guardNames: string[],
): boolean => {
  const { consumed, consumer } = unwrapUpwards(binaryNode);
  if (
    !consumer ||
    !isNodeOfType(consumer, "VariableDeclarator") ||
    consumer.init !== consumed ||
    !isNodeOfType(consumer.id, "Identifier")
  ) {
    return false;
  }
  const bindingIdentifier = consumer.id;
  const consumerSiteGuardNames = [...guardNames, bindingIdentifier.name];
  const scopeOwner = findScopeOwner(binaryNode);
  if (!scopeOwner) return false;
  let firstConsumerOffset: number | null = null;
  let firstNanHandledOffset: number | null = null;
  walkAst(scopeOwner, (child: EsTreeNode) => {
    if (
      !isNodeOfType(child, "Identifier") ||
      child.name !== bindingIdentifier.name ||
      child === bindingIdentifier ||
      !isReferenceToBinding(child, bindingIdentifier)
    ) {
      return;
    }
    if (isNanHandledReference(child)) {
      const handledOffset = nodeStartOffset(child);
      if (firstNanHandledOffset === null || handledOffset < firstNanHandledOffset) {
        firstNanHandledOffset = handledOffset;
      }
      return;
    }
    if (isDirectNumericConsumer(child, true)) {
      if (isGuardedByEnclosingTest(child, consumerSiteGuardNames)) return;
      if (isGuardedByPrecedingEarlyExit(child, consumerSiteGuardNames)) return;
      const consumerOffset = nodeStartOffset(child);
      if (firstConsumerOffset === null || consumerOffset < firstConsumerOffset) {
        firstConsumerOffset = consumerOffset;
      }
    }
  });
  if (firstConsumerOffset === null) return false;
  return firstNanHandledOffset === null || firstConsumerOffset < firstNanHandledOffset;
};

const isNumericConsumerContext = (binaryNode: EsTreeNode, guardNames: string[]): boolean =>
  isDirectNumericConsumer(binaryNode) || flowsIntoNumericConsumerViaBinding(binaryNode, guardNames);

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
    // A non-default `case` narrows the chain: when the root is nullish the
    // discriminant `order?.status` is undefined, which matches no literal case.
    if (
      isNodeOfType(ancestor, "SwitchCase") &&
      ancestor.test !== null &&
      ancestor.parent &&
      isNodeOfType(ancestor.parent, "SwitchStatement") &&
      subtreeReferencesAnyName(ancestor.parent.discriminant, guardNames)
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
        if (!isNodeOfType(precedingStatement, "IfStatement")) continue;
        if (!subtreeReferencesAnyName(precedingStatement.test, guardNames)) continue;
        // `if (!x) return;` — and the inverted spelling `if (x) {...} else
        // { return; }` — both narrow the guard for everything that follows.
        if (
          isEarlyExitStatement(precedingStatement.consequent) ||
          isEarlyExitStatement(precedingStatement.alternate)
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

// The arithmetic's NaN is provably discarded before observation: its value
// lands in a declarator whose bindings are not read before a following
// early-exit guard on the chain consumes the miss case —
// `const pagination = { pageCount: Math.ceil(tag?.blog_articles?.length /
// pageSize) }; if (!tag?.blog_articles || …) return null;` puts every
// observable read of `pagination` after the guard.
const isDiscardedByEarlyExitBeforeFirstBindingUse = (
  binaryNode: EsTreeNode,
  guardNames: string[],
): boolean => {
  let child: EsTreeNode = binaryNode;
  let ancestor: EsTreeNode | null | undefined = binaryNode.parent;
  while (ancestor && !isNodeOfType(ancestor, "BlockStatement")) {
    if (isFunctionLike(ancestor)) return false;
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  if (!ancestor || !isNodeOfType(child, "VariableDeclaration")) return false;
  const declaredNames = child.declarations.flatMap((declarator) =>
    isNodeOfType(declarator.id, "Identifier") ? [declarator.id.name] : [],
  );
  if (declaredNames.length === 0) return false;
  const statements = ancestor.body;
  const declarationIndex = statements.findIndex((statement) => statement === child);
  if (declarationIndex < 0) return false;
  for (const following of statements.slice(declarationIndex + 1)) {
    const followingStatement = following as EsTreeNode;
    if (
      isNodeOfType(followingStatement, "IfStatement") &&
      (isEarlyExitStatement(followingStatement.consequent) ||
        isEarlyExitStatement(followingStatement.alternate)) &&
      subtreeReferencesAnyName(followingStatement.test, guardNames) &&
      !declaredNames.some((name) => subtreeReferencesName(followingStatement, name))
    ) {
      return true;
    }
    if (declaredNames.some((name) => subtreeReferencesName(followingStatement, name))) {
      return false;
    }
  }
  return false;
};

// Flags `a?.b * n` / `a?.b / n` / `a?.b % n` (or a variable bound to `a?.b`)
// when the result flows into a numeric consumer and no `??` fallback or
// enclosing guard on the chain root exists. Additive operators, the
// `?.length - 1` index idiom, `?.()` call forms, and guarded roots stay
// quiet — as do arithmetic under an enclosing test of a same-parent-chain
// sibling alias (`procTotal ? procOnline / procTotal : 0.25`) and results
// whose declarator is only read after a following early-exit guard on the
// chain consumed the miss case.
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
        const enclosingTestGuardNames = [
          ...guardNames,
          ...resolveEnclosingTestOnlyGuardNames(operand),
        ];
        if (isGuardedByEnclosingTest(node as EsTreeNode, enclosingTestGuardNames)) continue;
        if (isGuardedByPrecedingEarlyExit(node as EsTreeNode, guardNames)) continue;
        if (isDiscardedByEarlyExitBeforeFirstBindingUse(node as EsTreeNode, guardNames)) continue;
        if (!isNumericConsumerContext(node as EsTreeNode, guardNames)) continue;
        context.report({ node, message: MESSAGE });
        return;
      }
    },
  }),
});
