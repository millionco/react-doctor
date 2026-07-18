import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getRootIdentifier } from "../../utils/get-root-identifier.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isPresenceProvenBeforeNode } from "../../utils/is-presence-proven-before-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { unwrapNegativeGuardForm } from "../../utils/unwrap-negative-guard-form.js";
import { walkAst } from "../../utils/walk-ast.js";
import { subtreeWritesSymbol } from "../../utils/subtree-writes-symbol.js";

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

const chainRootIdentifier = (
  memberExpression: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  let current = stripKeepingChain(memberExpression);
  while (true) {
    if (isNodeOfType(current, "ChainExpression")) {
      current = stripKeepingChain(current.expression as EsTreeNode);
      continue;
    }
    if (isNodeOfType(current, "MemberExpression")) {
      current = stripKeepingChain(current.object as EsTreeNode);
      continue;
    }
    return isNodeOfType(current, "Identifier") ? current : null;
  }
};

const guardKeyForPath = (node: EsTreeNode, context: RuleContext): string | null => {
  const path = chainMemberPath(node);
  const root = chainRootIdentifier(node);
  const symbol = root ? context.scopes.symbolFor(root) : null;
  if (!path || !root) return null;
  return symbol ? `${symbol.id}:${path}` : `global:${path}`;
};

const optionalChainGuardKey = (
  memberExpression: EsTreeNode,
  context: RuleContext,
): string | null => {
  let current = stripKeepingChain(memberExpression);
  while (true) {
    if (isNodeOfType(current, "ChainExpression")) {
      current = stripKeepingChain(current.expression as EsTreeNode);
      continue;
    }
    if (!isNodeOfType(current, "MemberExpression")) return null;
    if (current.optional) return guardKeyForPath(current.object as EsTreeNode, context);
    current = stripKeepingChain(current.object as EsTreeNode);
  }
};

const aliasesByScope = new WeakMap<
  EsTreeNode,
  Map<string, Array<{ guardKey: string; offset: number }>>
>();

const indexScopeAliases = (scopeOwner: EsTreeNode, context: RuleContext) => {
  const existing = aliasesByScope.get(scopeOwner);
  if (existing) return existing;
  const aliases = new Map<string, Array<{ guardKey: string; offset: number }>>();
  walkAst(scopeOwner, (child) => {
    if (
      !isNodeOfType(child, "VariableDeclarator") ||
      !isNodeOfType(child.id, "Identifier") ||
      !child.init ||
      findScopeOwner(child) !== scopeOwner ||
      !isNodeOfType(child.parent, "VariableDeclaration") ||
      child.parent.kind !== "const"
    ) {
      return;
    }
    const initializerMember = asDirectOptionalChainMember(child.init);
    const initializerPath = initializerMember ? chainMemberPath(initializerMember) : null;
    const aliasSymbol = context.scopes.symbolFor(child.id);
    if (!initializerPath || !aliasSymbol) return;
    const guardKey = `${aliasSymbol.id}:${child.id.name}`;
    const candidates = aliases.get(initializerPath) ?? [];
    candidates.push({ guardKey, offset: child.range[0] });
    aliases.set(initializerPath, candidates);
  });
  aliasesByScope.set(scopeOwner, aliases);
  return aliases;
};

// Same-scope bindings that alias the exact chain being multiplied
// (`const price = item?.price;` before `item?.price * 2`) — a guard on the
// alias narrows the chain just as soundly as a guard on the root. Only
// declarators whose OWN function scope encloses the arithmetic count: a
// same-named alias inside a sibling nested function is a different
// variable, and crediting its name would let an unrelated `if (price)`
// suppress real findings.
const collectSameChainAliasNames = (operandMember: EsTreeNode, context: RuleContext): string[] => {
  const operandPath = chainMemberPath(operandMember);
  if (!operandPath) return [];
  const scopeOwner = findScopeOwner(operandMember);
  if (!scopeOwner) return [];
  return (indexScopeAliases(scopeOwner, context).get(operandPath) ?? [])
    .filter((alias) => alias.offset < operandMember.range[0])
    .map((alias) => alias.guardKey);
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
const resolveOptionalChainOperandGuardNames = (
  operand: EsTreeNode,
  context: RuleContext,
): string[] | null => {
  const direct = asDirectOptionalChainMember(operand);
  if (direct) {
    const guardKey = optionalChainGuardKey(direct, context);
    return guardKey ? [guardKey, ...collectSameChainAliasNames(direct, context)] : null;
  }

  const stripped = stripKeepingChain(operand);
  if (!isNodeOfType(stripped, "Identifier")) return null;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding?.initializer) return null;
  const initializerMember = asDirectOptionalChainMember(binding.initializer);
  if (!initializerMember) return null;
  const guardKey = optionalChainGuardKey(initializerMember, context);
  const symbol = context.scopes.symbolFor(stripped);
  return guardKey && symbol ? [guardKey, `${symbol.id}:${stripped.name}`] : null;
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
  context: RuleContext,
  treatTestComparisonAsGuard = false,
): boolean => {
  const { consumed, consumer } = unwrapUpwards(valueNode);
  if (!consumer) return false;
  if (isNodeOfType(consumer, "ReturnStatement") && consumer.argument === consumed) return true;
  if (
    isNodeOfType(consumer, "MemberExpression") &&
    consumer.object === consumed &&
    getStaticPropertyName(consumer) !== null &&
    NUMERIC_FORMAT_METHOD_NAMES.has(getStaticPropertyName(consumer) ?? "")
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
  const mathReceiver =
    isNodeOfType(consumer, "CallExpression") && isNodeOfType(consumer.callee, "MemberExpression")
      ? stripKeepingChain(consumer.callee.object as EsTreeNode)
      : null;
  if (
    isNodeOfType(consumer, "CallExpression") &&
    isNodeOfType(mathReceiver, "Identifier") &&
    mathReceiver.name === "Math" &&
    context.scopes.isGlobalReference(mathReceiver) &&
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

const isSafeNaNReplacement = (node: EsTreeNode): boolean => {
  const value = stripKeepingChain(node);
  return (
    isNodeOfType(value, "Literal") &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
  );
};

const nanCheckClampsBinding = (
  call: EsTreeNodeOfType<"CallExpression">,
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const enclosingIf = call.parent;
  if (!enclosingIf || !isNodeOfType(enclosingIf, "IfStatement") || enclosingIf.test !== call) {
    return false;
  }
  const symbol = context.scopes.symbolFor(identifier);
  let hasSafeAssignment = false;
  walkAst(enclosingIf.consequent, (child) => {
    if (hasSafeAssignment || !isNodeOfType(child, "AssignmentExpression")) return;
    if (
      child.operator === "=" &&
      isNodeOfType(child.left, "Identifier") &&
      context.scopes.symbolFor(child.left)?.id === symbol?.id &&
      isSafeNaNReplacement(child.right as EsTreeNode)
    ) {
      hasSafeAssignment = true;
      return false;
    }
  });
  return hasSafeAssignment;
};

const isNanHandledReference = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.operator === "=" &&
    parent.left === identifier &&
    isSafeNaNReplacement(parent.right as EsTreeNode)
  ) {
    return true;
  }
  if (
    isNodeOfType(parent, "CallExpression") &&
    (parent.arguments ?? []).some((argument) => argument === identifier)
  ) {
    const callee = stripKeepingChain(parent.callee);
    if (
      isNodeOfType(callee, "Identifier") &&
      NAN_CHECK_CALLEE_NAMES.has(callee.name) &&
      context.scopes.isGlobalReference(callee)
    ) {
      return nanCheckClampsBinding(parent, identifier, context);
    }
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "Number" &&
      context.scopes.isGlobalReference(callee.object) &&
      NAN_CHECK_CALLEE_NAMES.has(getStaticPropertyName(callee) ?? "")
    ) {
      return nanCheckClampsBinding(parent, identifier, context);
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

// A numeric consumer reached through an intermediate binding:
// `const share = a?.b / total; share.toFixed(2)`. Order-aware: a NaN check or
// finite-value replacement suppresses only the consumers that come after it — a
// consumer that reads the binding first already received the NaN. Each
// consumer SITE is also checked against the guards individually: the
// hooks-before-early-returns ordering React forces ("derive first, guard
// second") puts the guard between the arithmetic and the consumer, and the
// RESULT binding itself is a valid guard subject because NaN is falsy
// (`if (!discount) return null;` catches the short-circuited case).
const flowsIntoNumericConsumerViaBinding = (
  binaryNode: EsTreeNode,
  guardNames: string[],
  context: RuleContext,
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
  const bindingSymbol = context.scopes.symbolFor(bindingIdentifier);
  const consumerSiteGuardNames = bindingSymbol
    ? [...guardNames, `${bindingSymbol.id}:${bindingIdentifier.name}`]
    : guardNames;
  let firstConsumerOffset: number | null = null;
  let firstNanHandledOffset: number | null = null;
  for (const reference of bindingSymbol?.references ?? []) {
    const child = reference.identifier;
    if (
      !isNodeOfType(child, "Identifier") ||
      child.name !== bindingIdentifier.name ||
      child === bindingIdentifier ||
      context.scopes.symbolFor(child)?.id !== bindingSymbol?.id
    ) {
      continue;
    }
    if (isNanHandledReference(child, context)) {
      const handledOffset = nodeStartOffset(child);
      if (firstNanHandledOffset === null || handledOffset < firstNanHandledOffset) {
        firstNanHandledOffset = handledOffset;
      }
      continue;
    }
    if (isDirectNumericConsumer(child, context, true)) {
      if (isGuardedByEnclosingTest(child, consumerSiteGuardNames, context)) continue;
      if (isGuardedByPrecedingEarlyExit(child, consumerSiteGuardNames, context)) continue;
      const consumerOffset = nodeStartOffset(child);
      if (firstConsumerOffset === null || consumerOffset < firstConsumerOffset) {
        firstConsumerOffset = consumerOffset;
      }
    }
  }
  if (firstConsumerOffset === null) return false;
  return firstNanHandledOffset === null || firstConsumerOffset < firstNanHandledOffset;
};

const isNumericConsumerContext = (
  binaryNode: EsTreeNode,
  guardNames: string[],
  context: RuleContext,
): boolean =>
  isDirectNumericConsumer(binaryNode, context) ||
  flowsIntoNumericConsumerViaBinding(binaryNode, guardNames, context);

const subtreeReferencesName = (
  node: EsTreeNode | null | undefined,
  guardKey: string,
  context: RuleContext,
): boolean => {
  if (!node) return false;
  let found = false;
  walkAst(node, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "Identifier") || isNodeOfType(child, "MemberExpression")) {
      if (guardKeyForPath(child, context) !== guardKey) return;
      found = true;
      return false;
    }
  });
  return found;
};

const subtreeReferencesAnyName = (
  node: EsTreeNode | null | undefined,
  guardNames: string[],
  context: RuleContext,
): boolean => guardNames.some((guardName) => subtreeReferencesName(node, guardName, context));

const testPositivelyReferencesAnyName = (
  test: EsTreeNode,
  guardNames: string[],
  context: RuleContext,
): boolean => {
  const expression = stripKeepingChain(test);
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") return false;
  if (isNodeOfType(expression, "LogicalExpression")) {
    if (expression.operator === "&&") {
      return (
        testPositivelyReferencesAnyName(expression.left as EsTreeNode, guardNames, context) ||
        testPositivelyReferencesAnyName(expression.right as EsTreeNode, guardNames, context)
      );
    }
    if (expression.operator === "||") {
      return (
        testPositivelyReferencesAnyName(expression.left as EsTreeNode, guardNames, context) &&
        testPositivelyReferencesAnyName(expression.right as EsTreeNode, guardNames, context)
      );
    }
  }
  if (
    isNodeOfType(expression, "BinaryExpression") &&
    (expression.operator === "===" ||
      expression.operator === "==" ||
      expression.operator === "!==" ||
      expression.operator === "!=")
  ) {
    const isAbsent = (operand: EsTreeNode): boolean => {
      const target = stripKeepingChain(operand);
      return (
        (isNodeOfType(target, "Literal") && target.value === null) ||
        (isNodeOfType(target, "Identifier") && target.name === "undefined")
      );
    };
    if (isAbsent(expression.left as EsTreeNode) || isAbsent(expression.right as EsTreeNode)) {
      return (
        (expression.operator === "!==" || expression.operator === "!=") &&
        subtreeReferencesAnyName(expression, guardNames, context)
      );
    }
  }
  return subtreeReferencesAnyName(expression, guardNames, context);
};

const subtreeWritesAnyGuardPath = (
  node: EsTreeNode,
  guardNames: string[],
  context: RuleContext,
  beforeNode?: EsTreeNode,
): boolean => {
  const symbolIds = new Set(
    guardNames
      .map((guardName) => Number(guardName.slice(0, guardName.indexOf(":"))))
      .filter(Number.isFinite),
  );
  return subtreeWritesSymbol(node, symbolIds, context, undefined, beforeNode);
};

const switchPathWritesAnyGuardBeforeNode = (
  switchCase: EsTreeNodeOfType<"SwitchCase">,
  node: EsTreeNode,
  guardNames: string[],
  context: RuleContext,
): boolean => {
  if (subtreeWritesAnyGuardPath(switchCase, guardNames, context, node)) {
    return true;
  }
  const switchStatement = switchCase.parent;
  if (!switchStatement || !isNodeOfType(switchStatement, "SwitchStatement")) return false;
  const switchCaseIndex = switchStatement.cases.findIndex(
    (candidateCase) => candidateCase === switchCase,
  );
  for (let caseIndex = switchCaseIndex - 1; caseIndex >= 0; caseIndex -= 1) {
    const precedingCase = switchStatement.cases[caseIndex];
    let didWriteGuardPath = false;
    let canFallThrough = true;
    for (const statementNode of precedingCase.consequent) {
      if (isEarlyExitStatement(statementNode)) {
        canFallThrough = false;
        break;
      }
      if (subtreeWritesAnyGuardPath(statementNode, guardNames, context)) {
        didWriteGuardPath = true;
      }
    }
    if (!canFallThrough) break;
    if (didWriteGuardPath) return true;
  }
  return false;
};

const writtenSymbolKeysByScope = new WeakMap<EsTreeNode, Set<string>>();

const indexWrittenSymbolKeys = (scopeOwner: EsTreeNode, context: RuleContext): Set<string> => {
  const existing = writtenSymbolKeysByScope.get(scopeOwner);
  if (existing) return existing;
  const writtenSymbolKeys = new Set<string>();
  walkAst(scopeOwner, (child) => {
    if (child !== scopeOwner && isFunctionLike(child)) return false;
    if (
      !isNodeOfType(child, "AssignmentExpression") &&
      !isNodeOfType(child, "UpdateExpression") &&
      !(isNodeOfType(child, "UnaryExpression") && child.operator === "delete")
    ) {
      return;
    }
    const writeTarget = isNodeOfType(child, "AssignmentExpression")
      ? (child.left as EsTreeNode)
      : (child.argument as EsTreeNode);
    const writeRoot = getRootIdentifier(writeTarget);
    const writeSymbol = writeRoot ? context.scopes.symbolFor(writeRoot) : null;
    if (writeSymbol) writtenSymbolKeys.add(String(writeSymbol.id));
  });
  writtenSymbolKeysByScope.set(scopeOwner, writtenSymbolKeys);
  return writtenSymbolKeys;
};

const guardPathsMayBeWritten = (
  node: EsTreeNode,
  guardNames: string[],
  context: RuleContext,
): boolean => {
  const scopeOwner = findScopeOwner(node);
  if (!scopeOwner) return false;
  const writtenSymbolKeys = indexWrittenSymbolKeys(scopeOwner, context);
  return guardNames.some((guardName) =>
    writtenSymbolKeys.has(guardName.slice(0, guardName.indexOf(":"))),
  );
};

// The chain can never short-circuit because an enclosing `if`/ternary
// test or `&&`-guard already narrowed the chain root or its alias binding.
// The arithmetic must sit in the guarded BRANCH, not in the test itself
// (otherwise the test of `if (a?.b * n < x)` would suppress its own finding).
const isGuardedByEnclosingTest = (
  binaryNode: EsTreeNode,
  guardNames: string[],
  context: RuleContext,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = binaryNode.parent;
  while (ancestor) {
    // A non-default `case` narrows the chain: when the root is nullish the
    // discriminant `order?.status` is undefined, which matches no literal case.
    if (
      isNodeOfType(ancestor, "SwitchCase") &&
      ancestor.test !== null &&
      ancestor.parent &&
      isNodeOfType(ancestor.parent, "SwitchStatement") &&
      subtreeReferencesAnyName(ancestor.parent.discriminant, guardNames, context) &&
      !switchPathWritesAnyGuardBeforeNode(ancestor, binaryNode, guardNames, context)
    ) {
      return true;
    }
    ancestor = ancestor.parent ?? null;
  }
  return isPresenceProvenBeforeNode(
    binaryNode,
    (test) => testPositivelyReferencesAnyName(test, guardNames, context),
    guardPathsMayBeWritten(binaryNode, guardNames, context)
      ? (candidate) => subtreeWritesAnyGuardPath(candidate, guardNames, context)
      : undefined,
  );
};

// A preceding sibling `if (!x) return;`-style guard dominates the arithmetic
// just like an enclosing test does — the single most common React narrowing
// idiom (`if (!invoice) return null;` before the math).
const isGuardedByPrecedingEarlyExit = (
  binaryNode: EsTreeNode,
  guardNames: string[],
  context: RuleContext,
): boolean => {
  return isPresenceProvenBeforeNode(
    binaryNode,
    (test) => testPositivelyReferencesAnyName(test, guardNames, context),
    guardPathsMayBeWritten(binaryNode, guardNames, context)
      ? (candidate) => subtreeWritesAnyGuardPath(candidate, guardNames, context)
      : undefined,
  );
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
  context: RuleContext,
): boolean => {
  const earlyExitTestProvesPresenceAfterward = (test: EsTreeNode): boolean => {
    const positiveForm = unwrapNegativeGuardForm(test);
    if (positiveForm) return testPositivelyReferencesAnyName(positiveForm, guardNames, context);
    const expression = stripKeepingChain(test);
    if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "||") {
      return (
        earlyExitTestProvesPresenceAfterward(expression.left as EsTreeNode) ||
        earlyExitTestProvesPresenceAfterward(expression.right as EsTreeNode)
      );
    }
    return false;
  };
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
      ((isEarlyExitStatement(followingStatement.consequent) &&
        earlyExitTestProvesPresenceAfterward(followingStatement.test)) ||
        (isEarlyExitStatement(followingStatement.alternate) &&
          testPositivelyReferencesAnyName(followingStatement.test, guardNames, context))) &&
      !declaredNames.some((name) => {
        let hasDeclaredName = false;
        walkAst(followingStatement, (child) => {
          if (hasDeclaredName) return false;
          if (isNodeOfType(child, "Identifier") && child.name === name) {
            hasDeclaredName = true;
            return false;
          }
        });
        return hasDeclaredName;
      })
    ) {
      return true;
    }
    if (
      declaredNames.some((name) => {
        let hasDeclaredName = false;
        walkAst(followingStatement, (child) => {
          if (hasDeclaredName) return false;
          if (isNodeOfType(child, "Identifier") && child.name === name) {
            hasDeclaredName = true;
            return false;
          }
        });
        return hasDeclaredName;
      })
    ) {
      return false;
    }
  }
  return false;
};

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
        const guardNames = resolveOptionalChainOperandGuardNames(operand, context);
        if (!guardNames) continue;
        if (isGuardedByEnclosingTest(node as EsTreeNode, guardNames, context)) continue;
        if (isGuardedByPrecedingEarlyExit(node as EsTreeNode, guardNames, context)) continue;
        if (isDiscardedByEarlyExitBeforeFirstBindingUse(node as EsTreeNode, guardNames, context)) {
          continue;
        }
        if (!isNumericConsumerContext(node as EsTreeNode, guardNames, context)) continue;
        context.report({ node, message: MESSAGE });
        return;
      }
    },
  }),
});
