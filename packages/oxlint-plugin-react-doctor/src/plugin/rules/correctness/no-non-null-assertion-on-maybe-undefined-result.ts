import { defineRule } from "../../utils/define-rule.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { isAlwaysMatchingRegexPattern } from "../../utils/is-always-matching-regex-pattern.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isObjectOfMemberAccess } from "../../utils/is-object-of-member-access.js";
import { isPresenceProvenBeforeNode } from "../../utils/is-presence-proven-before-node.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { singleExpressionPredicateBody } from "../../utils/single-expression-predicate-body.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "../../utils/strip-paren-expression.js";
import { subtreeWritesSymbol } from "../../utils/subtree-writes-symbol.js";
import { unwrapNegativeGuardForm } from "../../utils/unwrap-negative-guard-form.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Deep structural equality over AST subtrees (positions and parent links
// ignored, regex literals compared by raw source). Needed to prove a
// `.some(pred)` guard uses the identical predicate as the asserted
// `.find(pred)!` — the shared `areExpressionsStructurallyEqual` deliberately
// refuses function nodes.
const NODE_COMPARISON_IGNORED_KEYS = new Set(["parent", "range", "loc", "start", "end"]);
const areNodesLooselyEqual = (first: unknown, second: unknown): boolean => {
  if (first === second) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((item, itemIndex) => areNodesLooselyEqual(item, second[itemIndex]))
    );
  }
  if (first instanceof RegExp || second instanceof RegExp) {
    return String(first) === String(second);
  }
  if (isAstNode(first) && isAstNode(second)) {
    if (first.type !== second.type) return false;
    const firstRecord = first as unknown as Record<string, unknown>;
    const secondRecord = second as unknown as Record<string, unknown>;
    const comparableKeys = new Set(
      [...Object.keys(firstRecord), ...Object.keys(secondRecord)].filter(
        (key) => !NODE_COMPARISON_IGNORED_KEYS.has(key),
      ),
    );
    for (const key of comparableKeys) {
      if (!areNodesLooselyEqual(firstRecord[key], secondRecord[key])) return false;
    }
    return true;
  }
  if (
    first !== null &&
    second !== null &&
    typeof first === "object" &&
    typeof second === "object"
  ) {
    const firstRecord = first as Record<string, unknown>;
    const secondRecord = second as Record<string, unknown>;
    const keys = new Set([...Object.keys(firstRecord), ...Object.keys(secondRecord)]);
    for (const key of keys) {
      if (!areNodesLooselyEqual(firstRecord[key], secondRecord[key])) return false;
    }
    return true;
  }
  return false;
};

// Built-in methods the language spec types as `T | undefined` / `T | null`
// on a miss: Array `find`/`findLast` (undefined), String `match` (null),
// Map/cache `get` (undefined). `pop`/`shift` are intentionally excluded —
// under a `.length` loop guard they are the idiomatic safe queue-drain —
// and `matchAll` returns an (empty) iterator, never null.
const NO_MATCH_MESSAGES: Readonly<Record<string, string>> = {
  find: "`.find(...)` returns `undefined` when nothing matches, so asserting `!` here crashes on the next access when the predicate misses; handle the missing case with optional chaining or a guard.",
  findLast:
    "`.findLast(...)` returns `undefined` when nothing matches, so asserting `!` here crashes on the next access when the predicate misses; handle the missing case with optional chaining or a guard.",
  match:
    "`.match(...)` returns `null` when the pattern does not match, so asserting `!` here crashes on the next index or access; check the result before reading it.",
  get: "`.get(...)` returns `undefined` when the key is absent, so asserting `!` here crashes on the next access when the key misses; check for the key or handle the missing value.",
};

const MUTATING_ARRAY_METHOD_NAMES = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

// Normalize a `.get(...)` receiver to a comparable path key so the
// presence proof can match the exact same map: `sides` (Identifier),
// `this` (ThisExpression), or a non-computed member chain like
// `this.updateCallbacks`. Computed or deeper shapes are not comparable.
const receiverPathKey = (node: EsTreeNode): string | null => {
  const target = stripParenExpression(node);
  if (isNodeOfType(target, "Identifier")) return target.name;
  if (isNodeOfType(target, "ThisExpression")) return "this";
  if (
    isNodeOfType(target, "MemberExpression") &&
    !target.computed &&
    isNodeOfType(target.property, "Identifier")
  ) {
    const objectKey = receiverPathKey(target.object as EsTreeNode);
    return objectKey ? `${objectKey}.${target.property.name}` : null;
  }
  return null;
};

// The outermost enclosing function (or Program at top level). A
// `map.get(key)!` inside a nested callback is still provably safe when the
// map is populated in the enclosing function (`for (...) sides.set(...)`),
// so the proof must look past the immediate scope up to the outermost one.
const findOutermostScope = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor = node.parent;
  let outermostFunction: EsTreeNode | null = null;
  let program: EsTreeNode | null = null;
  while (ancestor) {
    if (isFunctionLike(ancestor)) outermostFunction = ancestor;
    if (isNodeOfType(ancestor, "Program")) {
      program = ancestor;
      break;
    }
    ancestor = ancestor.parent ?? null;
  }
  return outermostFunction ?? program;
};

// Methods that populate the map, check the key, or hand out keys that are
// present by construction (`for (const k of map.keys()) map.get(k)!`).
const KEY_PRESENCE_METHOD_NAMES = new Set(["set", "keys", "entries", "forEach"]);

const relevantCallsByScope = new WeakMap<EsTreeNode, EsTreeNodeOfType<"CallExpression">[]>();

const indexedRelevantCalls = (scope: EsTreeNode): EsTreeNodeOfType<"CallExpression">[] => {
  const existing = relevantCallsByScope.get(scope);
  if (existing) return existing;
  const calls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(scope, (child) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    const methodName = isNodeOfType(callee, "MemberExpression")
      ? getStaticPropertyName(callee)
      : null;
    if (methodName !== "get" && methodName !== "find" && methodName !== "match") {
      calls.push(child);
    }
  });
  relevantCallsByScope.set(scope, calls);
  return calls;
};

const isUnconditionallyBefore = (
  candidate: EsTreeNode,
  assertion: EsTreeNode,
  scope: EsTreeNode,
): boolean => {
  if (candidate.range[0] >= assertion.range[0]) return false;
  let ancestor = candidate.parent ?? null;
  while (ancestor && ancestor !== scope) {
    if (isFunctionLike(ancestor)) return false;
    if (
      isNodeOfType(ancestor, "IfStatement") ||
      isNodeOfType(ancestor, "ConditionalExpression") ||
      isNodeOfType(ancestor, "LogicalExpression") ||
      isNodeOfType(ancestor, "SwitchCase") ||
      isNodeOfType(ancestor, "TryStatement")
    ) {
      return false;
    }
    ancestor = ancestor.parent ?? null;
  }
  return ancestor === scope;
};

// A `map.get(key)!` is likely safe when the same map is populated or
// checked (`map.set(...)` / `map.has(...)`), iterated by its own keys, or
// passed as an argument to a helper (which may populate it) somewhere in
// the enclosing scope, so abstain there — a false negative is preferable
// to a false positive. Matches `this.updateCallbacks`-style member
// receivers too, not just bare identifiers.
const scopeProvesKeyPresence = (
  assertion: EsTreeNode,
  receiver: EsTreeNodeOfType<"Identifier">,
  lookupKey: EsTreeNode,
  context: RuleContext,
): boolean => {
  const scope = findOutermostScope(assertion);
  if (!scope) return false;
  const receiverSymbol = context.scopes.symbolFor(receiver);
  if (!receiverSymbol) return false;
  const receiverMatches = (candidate: EsTreeNode): boolean => {
    const target = stripParenExpression(candidate);
    return (
      isNodeOfType(target, "Identifier") &&
      context.scopes.symbolFor(target)?.id === receiverSymbol.id
    );
  };
  const hasGuard = isPresenceProvenBeforeNode(assertion, (test) =>
    testPositivelyContainsCall(test, (call) => {
      const callee = call.callee;
      return Boolean(
        isNodeOfType(callee, "MemberExpression") &&
        getStaticPropertyName(callee) === "has" &&
        receiverMatches(callee.object as EsTreeNode) &&
        areNodesLooselyEqual(call.arguments[0], lookupKey),
      );
    }),
  );
  if (hasGuard) return true;
  for (const child of indexedRelevantCalls(scope)) {
    if (!isUnconditionallyBefore(child, assertion, scope)) continue;
    const callee = child.callee;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      KEY_PRESENCE_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
      receiverMatches(callee.object as EsTreeNode)
    ) {
      const methodName = getStaticPropertyName(callee);
      if (methodName === "set" && !areNodesLooselyEqual(child.arguments[0], lookupKey)) continue;
      if (methodName === "set") {
        const lookupKeyExpression = stripParenExpression(lookupKey);
        const lookupKeySymbol = isNodeOfType(lookupKeyExpression, "Identifier")
          ? context.scopes.symbolFor(lookupKeyExpression)
          : null;
        const didWriteLookupKey = Boolean(
          lookupKeySymbol?.references.some(
            (reference) =>
              reference.flag !== "read" &&
              reference.identifier.range[0] > child.range[0] &&
              reference.identifier.range[0] < assertion.range[0],
          ),
        );
        if (didWriteLookupKey) continue;
        const isInvalidated = indexedRelevantCalls(scope).some((laterCall) => {
          if (
            laterCall.range[0] <= child.range[0] ||
            laterCall.range[0] >= assertion.range[0] ||
            !isUnconditionallyBefore(laterCall, assertion, scope)
          ) {
            return false;
          }
          const laterCallee = laterCall.callee;
          if (
            !isNodeOfType(laterCallee, "MemberExpression") ||
            !receiverMatches(laterCallee.object as EsTreeNode)
          ) {
            return false;
          }
          const laterMethodName = getStaticPropertyName(laterCallee);
          return (
            laterMethodName === "clear" ||
            (laterMethodName === "delete" &&
              areNodesLooselyEqual(laterCall.arguments[0], lookupKey))
          );
        });
        if (isInvalidated) continue;
      }
      return true;
    }
    if ((child.arguments ?? []).some((argument) => receiverMatches(argument as EsTreeNode))) {
      return true;
    }
  }
  return false;
};

// The `get` branch only fires when the map's emptiness at construction is
// provable in scope: the receiver must be a local variable initialized with
// a bare `new Map()` / `new WeakMap()` (no entries argument). Parameters,
// call-initialized variables (`const sides = assignSides(...)`), `new
// Map(entries)` lookups, `this.*` fields, and unresolvable receivers all
// carry cross-function population invariants the rule cannot see, so they
// abstain.
const isBareMapConstruction = (
  node: EsTreeNode | null | undefined,
  context: RuleContext,
): boolean => {
  if (!node) return false;
  const target = stripParenExpression(node);
  return (
    isNodeOfType(target, "NewExpression") &&
    isNodeOfType(target.callee, "Identifier") &&
    context.scopes.isGlobalReference(target.callee) &&
    (target.callee.name === "Map" || target.callee.name === "WeakMap") &&
    target.arguments.length === 0
  );
};

const scopeDeclaresEmptyMap = (
  receiver: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const binding = findVariableInitializer(receiver, receiver.name);
  return isBareMapConstruction(binding?.initializer, context);
};

// Normalize the regex a `.match(...)` receives so it can be compared with
// the receiver of a `.test(...)` call: same identifier, a member chain
// (`this.pattern`), or a regex literal with the same pattern. The `g`/`y`
// flags are dropped from the key — `/x/.test(s)` proves `s.match(/x/g)`
// returns a non-empty array — while semantic flags (`i`, `m`, `s`, `u`)
// must agree for the proof to hold.
const regexComparableKey = (node: EsTreeNode, context?: RuleContext): string | null => {
  const target = stripParenExpression(node);
  if (isNodeOfType(target, "Identifier")) {
    const symbol = context?.scopes.symbolFor(target);
    return symbol ? `id:${symbol.id}` : `id:${target.name}`;
  }
  if (isNodeOfType(target, "Literal") && "regex" in target && target.regex) {
    const semanticFlags = String(target.regex.flags ?? "").replaceAll(/[gy]/g, "");
    return `regex:${target.regex.pattern}:${semanticFlags}`;
  }
  const memberPath = receiverPathKey(target);
  return memberPath && memberPath.includes(".") ? `path:${memberPath}` : null;
};

// Walks up through `&&`/`||` and parens: is this expression consumed as a
// boolean — a branch test (`if`/ternary/`while`) or under a `!` negation
// (`node => !!node.className.match(re)` predicate coercion)? A `.match(...)`
// consumed as a boolean is the guard of a validate-then-extract, not an
// extraction. `ParenthesizedExpression` is a real oxc runtime node absent
// from the TSESTree union, so it is matched by `.type` string, not
// `isNodeOfType`.
// `str.match(re)!` is likely on a proven-matching path when the enclosing
// scope also runs `re.test(...)` (validate-then-extract) or guards on
// another `.match(...)` of the same regex in boolean-test position
// (`if (!line.match(re)) return null; line.match(re)![1]`, or a
// `findUpUntil(el, (n) => !!n.className.match(re))` predicate whose hit
// is re-matched on the next line), so abstain.
const testPositivelyContainsCall = (
  test: EsTreeNode,
  isGuardCall: (call: EsTreeNodeOfType<"CallExpression">) => boolean,
): boolean => {
  const expression = stripParenExpression(test);
  if (unwrapNegativeGuardForm(expression)) return false;
  if (isNodeOfType(expression, "BinaryExpression")) {
    const hasBooleanLiteral = (value: boolean): boolean =>
      [expression.left, expression.right].some((operand) => {
        const target = stripParenExpression(operand as EsTreeNode);
        return isNodeOfType(target, "Literal") && target.value === value;
      });
    const falseLiteral = hasBooleanLiteral(false);
    const trueLiteral = hasBooleanLiteral(true);
    if (
      (falseLiteral && (expression.operator === "===" || expression.operator === "==")) ||
      (trueLiteral && (expression.operator === "!==" || expression.operator === "!="))
    ) {
      return false;
    }
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    if (expression.operator === "&&") {
      return (
        testPositivelyContainsCall(expression.left as EsTreeNode, isGuardCall) ||
        testPositivelyContainsCall(expression.right as EsTreeNode, isGuardCall)
      );
    }
    if (expression.operator === "||") {
      return (
        testPositivelyContainsCall(expression.left as EsTreeNode, isGuardCall) &&
        testPositivelyContainsCall(expression.right as EsTreeNode, isGuardCall)
      );
    }
  }
  let proven = false;
  walkAst(expression, (child) => {
    if (proven) return false;
    if (isNodeOfType(child, "CallExpression") && isGuardCall(child)) {
      proven = true;
      return false;
    }
  });
  return proven;
};

const scopeProvesMatchTested = (
  assertion: EsTreeNode,
  regexKey: string,
  matchReceiver: EsTreeNode,
  context: RuleContext,
): boolean =>
  isPresenceProvenBeforeNode(assertion, (test) =>
    testPositivelyContainsCall(test, (call) => {
      const callee = call.callee;
      if (!isNodeOfType(callee, "MemberExpression")) return false;
      const methodName = getStaticPropertyName(callee);
      if (methodName === "test") {
        return (
          regexComparableKey(callee.object as EsTreeNode, context) === regexKey &&
          Boolean(
            call.arguments[0] &&
            areNodesLooselyEqual(
              stripParenExpression(call.arguments[0] as EsTreeNode),
              stripParenExpression(matchReceiver),
            ),
          )
        );
      }
      return (
        methodName === "match" &&
        areNodesLooselyEqual(
          stripParenExpression(callee.object as EsTreeNode),
          stripParenExpression(matchReceiver),
        ) &&
        Boolean(
          call.arguments[0] &&
          regexComparableKey(call.arguments[0] as EsTreeNode, context) === regexKey,
        )
      );
    }),
  );

const SINGLE_REQUIRED_LITERAL_PATTERN = /^\^([^\\.^$*+?()[\]{}|])\+$/;

const isMatchingCharacterIndexGuard = (
  test: EsTreeNode,
  sliceReceiver: EsTreeNode,
  sliceStart: EsTreeNode,
  requiredCharacter: string,
  comparisonOperator: "===" | "!==",
): boolean => {
  const target = stripParenExpression(test);
  if (!isNodeOfType(target, "BinaryExpression") || target.operator !== comparisonOperator) {
    return false;
  }
  const operandPairs = [
    [target.left, target.right],
    [target.right, target.left],
  ];
  return operandPairs.some(([candidateIndexRead, candidateCharacter]) => {
    const indexRead = stripParenExpression(candidateIndexRead as EsTreeNode);
    const character = stripParenExpression(candidateCharacter as EsTreeNode);
    return (
      isNodeOfType(indexRead, "MemberExpression") &&
      indexRead.computed &&
      areNodesLooselyEqual(indexRead.object, sliceReceiver) &&
      areNodesLooselyEqual(indexRead.property, sliceStart) &&
      isNodeOfType(character, "Literal") &&
      character.value === requiredCharacter
    );
  });
};

const isFirstStatementOnBranch = (assertion: EsTreeNode, branch: EsTreeNode): boolean => {
  if (!isNodeOfType(branch, "BlockStatement")) return branch === assertion;
  const firstStatement = branch.body[0];
  if (!firstStatement) return false;
  let ancestor: EsTreeNode | null = assertion;
  while (ancestor && ancestor !== branch) {
    if (ancestor === firstStatement) return true;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const getAssertedResultAccess = (
  assertion: EsTreeNode,
): EsTreeNodeOfType<"MemberExpression"> | null => {
  const parent = assertion.parent;
  return parent && isNodeOfType(parent, "MemberExpression") && parent.object === assertion
    ? parent
    : null;
};

const isDirectCharacterMatchStatement = (assertion: EsTreeNode): boolean => {
  const resultAccess = getAssertedResultAccess(assertion);
  const resultConsumer = resultAccess?.parent;
  if (!resultAccess || !resultConsumer) return false;
  if (isNodeOfType(resultConsumer, "ReturnStatement")) {
    return resultConsumer.argument === resultAccess;
  }
  if (!isNodeOfType(resultConsumer, "VariableDeclarator") || resultConsumer.init !== resultAccess) {
    return false;
  }
  const declaration = resultConsumer.parent;
  return (
    Boolean(declaration) &&
    isNodeOfType(declaration, "VariableDeclaration") &&
    declaration.declarations.length === 1
  );
};

const isGuardedAnchoredCharacterMatch = (
  assertion: EsTreeNode,
  matchReceiver: EsTreeNode,
  pattern: EsTreeNode,
): boolean => {
  if (!isNodeOfType(pattern, "Literal") || !("regex" in pattern)) return false;
  const requiredCharacterMatch = SINGLE_REQUIRED_LITERAL_PATTERN.exec(pattern.regex?.pattern ?? "");
  const requiredCharacter = requiredCharacterMatch?.[1];
  if (!requiredCharacter) return false;
  if (!isDirectCharacterMatchStatement(assertion)) return false;
  const slicedValue = stripParenExpression(matchReceiver);
  if (!isNodeOfType(slicedValue, "CallExpression")) return false;
  const sliceCallee = stripParenExpression(slicedValue.callee as EsTreeNode);
  if (
    !isNodeOfType(sliceCallee, "MemberExpression") ||
    getPropertyName(sliceCallee) !== "slice" ||
    slicedValue.arguments.length !== 1 ||
    !slicedValue.arguments[0]
  ) {
    return false;
  }
  const sliceReceiver = stripParenExpression(sliceCallee.object as EsTreeNode);
  const sliceStart = stripParenExpression(slicedValue.arguments[0] as EsTreeNode);
  if (
    !isNodeOfType(sliceReceiver, "Identifier") ||
    (!isNodeOfType(sliceStart, "Identifier") && !isNodeOfType(sliceStart, "Literal"))
  ) {
    return false;
  }
  let child: EsTreeNode = assertion;
  let ancestor = assertion.parent ?? null;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ancestor.consequent === child &&
      isFirstStatementOnBranch(assertion, child) &&
      isMatchingCharacterIndexGuard(
        ancestor.test,
        sliceReceiver,
        sliceStart,
        requiredCharacter,
        "===",
      )
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement")) {
      const assertionStatementIndex = ancestor.body.findIndex((statement) => statement === child);
      const precedingStatement = ancestor.body[assertionStatementIndex - 1];
      if (
        assertionStatementIndex > 0 &&
        isNodeOfType(precedingStatement, "IfStatement") &&
        !precedingStatement.alternate &&
        isEarlyExitStatement(precedingStatement.consequent) &&
        isMatchingCharacterIndexGuard(
          precedingStatement.test,
          sliceReceiver,
          sliceStart,
          requiredCharacter,
          "!==",
        )
      ) {
        return true;
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const getRootIdentifier = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let target = stripParenExpression(node);
  while (isNodeOfType(target, "MemberExpression")) {
    if (target.computed || !isNodeOfType(target.property, "Identifier")) return null;
    target = stripParenExpression(target.object as EsTreeNode);
  }
  return isNodeOfType(target, "Identifier") ? target : null;
};

const CLOUDSCAPE_DOM_MODULE = "@cloudscape-design/component-toolkit/dom";

const stableRegexKey = (pattern: EsTreeNode, context: RuleContext): string | null => {
  const target = stripParenExpression(pattern);
  if (isNodeOfType(target, "Literal") && "regex" in target && target.regex) {
    return /[gy]/.test(target.regex.flags ?? "") ? null : regexComparableKey(target);
  }
  if (!isNodeOfType(target, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(target);
  const initializer = symbol?.initializer ? stripParenExpression(symbol.initializer) : null;
  if (
    symbol?.kind !== "const" ||
    symbol.references.some((reference) => reference.flag !== "read") ||
    !initializer ||
    !isNodeOfType(initializer, "Literal") ||
    !("regex" in initializer) ||
    !initializer.regex ||
    /[gy]/.test(initializer.regex.flags ?? "")
  ) {
    return null;
  }
  return regexComparableKey(initializer);
};

const areRegexPatternsEquivalent = (
  first: EsTreeNode,
  second: EsTreeNode,
  context: RuleContext,
): boolean => {
  const firstKey = stableRegexKey(first, context);
  const secondKey = stableRegexKey(second, context);
  if (!firstKey || firstKey !== secondKey) return false;
  const firstPattern = stripParenExpression(first);
  const secondPattern = stripParenExpression(second);
  if (!isNodeOfType(firstPattern, "Identifier") || !isNodeOfType(secondPattern, "Identifier")) {
    return true;
  }
  const firstSymbol = context.scopes.symbolFor(firstPattern);
  return Boolean(firstSymbol && firstSymbol === context.scopes.symbolFor(secondPattern));
};

const doesPredicateTruthRequireMatch = (
  matchCall: EsTreeNode,
  predicateFunction: EsTreeNode,
): boolean => {
  if (!isFunctionLike(predicateFunction)) return false;
  if (
    isNodeOfType(predicateFunction.body, "BlockStatement") &&
    (predicateFunction.body.body.length !== 1 ||
      !isNodeOfType(predicateFunction.body.body[0], "ReturnStatement"))
  ) {
    return false;
  }
  let isNegated = false;
  let child = matchCall;
  let parent = matchCall.parent ?? null;
  while (parent && parent !== predicateFunction) {
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") {
      isNegated = !isNegated;
      child = parent;
      parent = parent.parent ?? null;
      continue;
    }
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === child
    ) {
      child = parent;
      parent = parent.parent ?? null;
      continue;
    }
    if (
      TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type) ||
      isNodeOfType(parent, "ChainExpression")
    ) {
      child = parent;
      parent = parent.parent ?? null;
      continue;
    }
    if (isNodeOfType(parent, "ReturnStatement") && parent.argument === child) {
      return !isNegated && parent.parent === predicateFunction.body;
    }
    return false;
  }
  return !isNegated && predicateFunction.body === child;
};

const isStringTypeofGuardForPath = (test: EsTreeNode, expectedPath: string): boolean => {
  const target = stripParenExpression(test);
  if (!isNodeOfType(target, "BinaryExpression") || target.operator !== "===") return false;
  const operandPairs = [
    [target.left, target.right],
    [target.right, target.left],
  ];
  return operandPairs.some(([candidateTypeof, candidateString]) => {
    const typeofExpression = stripParenExpression(candidateTypeof as EsTreeNode);
    const stringLiteral = stripParenExpression(candidateString as EsTreeNode);
    return (
      isNodeOfType(typeofExpression, "UnaryExpression") &&
      typeofExpression.operator === "typeof" &&
      receiverPathKey(typeofExpression.argument as EsTreeNode) === expectedPath &&
      isNodeOfType(stringLiteral, "Literal") &&
      stringLiteral.value === "string"
    );
  });
};

const isImmediatelyGuardedFinderResult = (
  assertion: EsTreeNode,
  resultSymbol: SymbolDescriptor,
  resultPath: string,
  context: RuleContext,
): boolean => {
  const declarator = resultSymbol.declarationNode;
  const declaration = declarator.parent;
  const declarationBlock = declaration?.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.declarations.length !== 1 ||
    !declarationBlock ||
    !isNodeOfType(declarationBlock, "BlockStatement")
  ) {
    return false;
  }
  const declarationIndex = declarationBlock.body.findIndex(
    (statement) => statement === declaration,
  );
  const guardingStatement = declarationBlock.body[declarationIndex + 1];
  if (
    declarationIndex < 0 ||
    !isNodeOfType(guardingStatement, "IfStatement") ||
    !isFirstStatementOnBranch(assertion, guardingStatement.consequent)
  ) {
    return false;
  }
  const guardTest = stripParenExpression(guardingStatement.test);
  if (!isNodeOfType(guardTest, "LogicalExpression") || guardTest.operator !== "&&") return false;
  const guardedResult = stripParenExpression(guardTest.left as EsTreeNode);
  return (
    isNodeOfType(guardedResult, "Identifier") &&
    context.scopes.symbolFor(guardedResult) === resultSymbol &&
    isStringTypeofGuardForPath(guardTest.right as EsTreeNode, resultPath)
  );
};

const isDirectFinderMatchReturn = (assertion: EsTreeNode): boolean => {
  const resultAccess = getAssertedResultAccess(assertion);
  if (!resultAccess) return false;
  const consumer = resultAccess.parent;
  if (isNodeOfType(consumer, "ReturnStatement")) return consumer.argument === resultAccess;
  return Boolean(
    consumer &&
    isNodeOfType(consumer, "LogicalExpression") &&
    consumer.operator === "??" &&
    consumer.left === resultAccess &&
    isNodeOfType(consumer.parent, "ReturnStatement") &&
    consumer.parent.argument === consumer,
  );
};

const pathUsesOptionalAccess = (node: EsTreeNode): boolean => {
  let current = node;
  while (true) {
    if (isNodeOfType(current, "ChainExpression")) {
      current = current.expression as EsTreeNode;
      continue;
    }
    if (!isNodeOfType(current, "MemberExpression")) return false;
    if (current.optional) return true;
    current = current.object as EsTreeNode;
  }
};

const isMatchProvenByFindUpUntilPredicate = (
  assertion: EsTreeNode,
  matchReceiver: EsTreeNode,
  assertedPattern: EsTreeNode,
  context: RuleContext,
): boolean => {
  const resultIdentifier = getRootIdentifier(matchReceiver);
  const resultPath = receiverPathKey(matchReceiver);
  if (!resultIdentifier || !resultPath) return false;
  const isOptionalResultPath = pathUsesOptionalAccess(matchReceiver);
  if (!isDirectFinderMatchReturn(assertion) && !isOptionalResultPath) return false;
  const resultSymbol = context.scopes.symbolFor(resultIdentifier);
  const initializer = resultSymbol?.initializer
    ? stripParenExpression(resultSymbol.initializer)
    : null;
  if (
    resultSymbol?.kind !== "const" ||
    !initializer ||
    !isNodeOfType(initializer, "CallExpression")
  ) {
    return false;
  }
  if (
    !isOptionalResultPath &&
    !isImmediatelyGuardedFinderResult(assertion, resultSymbol, resultPath, context)
  ) {
    return false;
  }
  const finderCallee = stripParenExpression(initializer.callee as EsTreeNode);
  if (
    !isNodeOfType(finderCallee, "Identifier") ||
    !(
      (context.scopes.symbolFor(finderCallee)?.kind === "import" &&
        getImportedNameFromModule(assertion, finderCallee.name, CLOUDSCAPE_DOM_MODULE) ===
          "findUpUntil") ||
      (finderCallee.name === "findUpUntil" && context.scopes.isGlobalReference(finderCallee))
    )
  ) {
    return false;
  }
  const predicateArgument = initializer.arguments[1];
  if (!predicateArgument) return false;
  const predicateFunction = resolveExactLocalFunction(
    predicateArgument as EsTreeNode,
    context.scopes,
  );
  if (!predicateFunction || !isFunctionLike(predicateFunction)) return false;
  if (predicateFunction.async || predicateFunction.generator) return false;
  const predicateParameter = predicateFunction.params?.[0];
  if (!isNodeOfType(predicateParameter, "Identifier")) return false;
  const resultRelativePath = resultPath.slice(resultIdentifier.name.length);
  let didProveMatch = false;
  walkAst(predicateFunction.body as EsTreeNode, (child) => {
    if (didProveMatch || isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee as EsTreeNode);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      getPropertyName(callee) !== "match" ||
      !child.arguments[0] ||
      !areRegexPatternsEquivalent(child.arguments[0] as EsTreeNode, assertedPattern, context) ||
      !doesPredicateTruthRequireMatch(child, predicateFunction)
    ) {
      return;
    }
    const predicateReceiver = stripParenExpression(callee.object as EsTreeNode);
    const predicateRoot = getRootIdentifier(predicateReceiver);
    const predicatePath = receiverPathKey(predicateReceiver);
    if (
      predicateRoot?.name === predicateParameter.name &&
      predicatePath?.slice(predicateParameter.name.length) === resultRelativePath
    ) {
      didProveMatch = true;
      return false;
    }
  });
  return didProveMatch;
};

// The scope proves the asserted `.find(pred)!` cannot miss: a
// `.some`/`.findIndex` guard with a structurally identical predicate on
// the same receiver (validate-then-extract for arrays, or ensure-then-find
// after a conditional push), or an `.includes(...)` membership check on a
// projection of the same receiver (`const ids = rows.map(r => r.id)`).
const scopeProvesFindMatch = (
  assertion: EsTreeNode,
  findReceiver: EsTreeNode,
  findPredicate: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isStablePredicate(findPredicate, context)) return false;
  return isPresenceProvenBeforeNode(assertion, (test) =>
    testPositivelyContainsCall(test, (call) => {
      const callee = call.callee;
      if (!isNodeOfType(callee, "MemberExpression")) return false;
      const methodName = getStaticPropertyName(callee);
      if (methodName === "some" || methodName === "findIndex") {
        const guardPredicate = call.arguments[0]
          ? stripParenExpression(call.arguments[0] as EsTreeNode)
          : null;
        if (!guardPredicate || !isStablePredicate(guardPredicate, context)) return false;
        if (methodName === "findIndex") {
          const comparison = call.parent;
          if (!comparison || !isNodeOfType(comparison, "BinaryExpression")) return false;
          const otherOperand = comparison.left === call ? comparison.right : comparison.left;
          const negativeOne = stripParenExpression(otherOperand as EsTreeNode);
          const isNegativeOne =
            isNodeOfType(negativeOne, "UnaryExpression") &&
            negativeOne.operator === "-" &&
            isNodeOfType(negativeOne.argument, "Literal") &&
            negativeOne.argument.value === 1;
          if (!isNegativeOne || (comparison.operator !== "!==" && comparison.operator !== "!=")) {
            return false;
          }
        }
        return (
          areNodesLooselyEqual(
            stripParenExpression(callee.object as EsTreeNode),
            stripParenExpression(findReceiver),
          ) &&
          areNodesLooselyEqual(
            call.arguments[0] ? stripParenExpression(call.arguments[0] as EsTreeNode) : null,
            stripParenExpression(findPredicate),
          )
        );
      }
      if (methodName !== "includes") return false;
      const lookupParts = findEqualityLookupParts(findPredicate);
      if (!lookupParts || !areNodesLooselyEqual(call.arguments[0], lookupParts.comparedValue)) {
        return false;
      }
      const includesReceiver = stripParenExpression(callee.object as EsTreeNode);
      if (!isNodeOfType(includesReceiver, "Identifier")) return false;
      const binding = findVariableInitializer(includesReceiver, includesReceiver.name);
      const initializer = binding?.initializer ? stripParenExpression(binding.initializer) : null;
      const projection =
        initializer &&
        isNodeOfType(initializer, "CallExpression") &&
        isNodeOfType(initializer.callee, "MemberExpression")
          ? initializer.arguments[0]
          : null;
      const projectionFunction = projection
        ? resolveExactLocalFunction(projection as EsTreeNode, context.scopes)
        : null;
      const projectionBody =
        projectionFunction &&
        (isNodeOfType(projectionFunction, "ArrowFunctionExpression") ||
          isNodeOfType(projectionFunction, "FunctionExpression"))
          ? singleExpressionPredicateBody(projectionFunction)
          : null;
      const projectionParameter =
        projectionFunction &&
        (isNodeOfType(projectionFunction, "ArrowFunctionExpression") ||
          isNodeOfType(projectionFunction, "FunctionExpression"))
          ? projectionFunction.params[0]
          : null;
      const projectionObject =
        projectionBody && isNodeOfType(projectionBody, "MemberExpression")
          ? stripParenExpression(projectionBody.object as EsTreeNode)
          : null;
      return Boolean(
        initializer &&
        isNodeOfType(initializer, "CallExpression") &&
        isNodeOfType(initializer.callee, "MemberExpression") &&
        getStaticPropertyName(initializer.callee) === "map" &&
        areNodesLooselyEqual(
          stripParenExpression(initializer.callee.object as EsTreeNode),
          stripParenExpression(findReceiver),
        ) &&
        projectionBody &&
        isNodeOfType(projectionBody, "MemberExpression") &&
        isNodeOfType(projectionParameter, "Identifier") &&
        isNodeOfType(projectionObject, "Identifier") &&
        projectionObject.name === projectionParameter.name &&
        getStaticPropertyName(projectionBody) === lookupParts.propertyName,
      );
    }),
  );
};

const isStablePredicate = (predicate: EsTreeNode, context: RuleContext): boolean => {
  const expression = stripParenExpression(predicate);
  if (
    isNodeOfType(expression, "Identifier") &&
    expression.name === "Boolean" &&
    context.scopes.isGlobalReference(expression)
  ) {
    return true;
  }
  const predicateFunction = resolveExactLocalFunction(expression, context.scopes);
  const functionNode =
    predicateFunction && isFunctionLike(predicateFunction)
      ? predicateFunction
      : isFunctionLike(expression)
        ? expression
        : null;
  if (!functionNode) return false;
  let isStable = true;
  walkAst(functionNode.body as EsTreeNode, (child) => {
    if (!isStable) return false;
    if (child !== functionNode.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") ||
      isNodeOfType(child, "AssignmentExpression") ||
      isNodeOfType(child, "UpdateExpression")
    ) {
      isStable = false;
      return false;
    }
  });
  return isStable;
};

const findEqualityLookupParts = (
  predicate: EsTreeNode,
): { propertyName: string; comparedValue: EsTreeNode } | null => {
  if (
    !isNodeOfType(predicate, "ArrowFunctionExpression") &&
    !isNodeOfType(predicate, "FunctionExpression")
  ) {
    return null;
  }
  const parameter = predicate.params[0];
  const body = singleExpressionPredicateBody(predicate);
  if (
    !isNodeOfType(parameter, "Identifier") ||
    !body ||
    !isNodeOfType(body, "BinaryExpression") ||
    body.operator !== "==="
  ) {
    return null;
  }
  const operandPairs: Array<[EsTreeNode, EsTreeNode]> = [
    [body.left as EsTreeNode, body.right as EsTreeNode],
    [body.right as EsTreeNode, body.left as EsTreeNode],
  ];
  for (const [candidateMember, comparedValue] of operandPairs) {
    const member = stripParenExpression(candidateMember);
    const memberObject = isNodeOfType(member, "MemberExpression")
      ? stripParenExpression(member.object as EsTreeNode)
      : null;
    if (
      isNodeOfType(member, "MemberExpression") &&
      memberObject &&
      isNodeOfType(memberObject, "Identifier") &&
      memberObject.name === parameter.name
    ) {
      const computedProperty = stripParenExpression(member.property as EsTreeNode);
      const propertyName =
        getStaticPropertyName(member) ??
        (member.computed &&
        isNodeOfType(computedProperty, "Literal") &&
        (typeof computedProperty.value === "number" || typeof computedProperty.value === "string")
          ? String(computedProperty.value)
          : null);
      if (propertyName) return { propertyName, comparedValue };
    }
  }
  return null;
};

const isEnsureThenFind = (
  assertion: EsTreeNode,
  findReceiver: EsTreeNode,
  findPredicate: EsTreeNode,
): boolean => {
  const lookupParts = findEqualityLookupParts(findPredicate);
  if (!lookupParts) return false;
  let child = assertion;
  let ancestor = assertion.parent ?? null;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (isNodeOfType(ancestor, "BlockStatement")) {
      const childIndex = ancestor.body.findIndex((statement) => statement === child);
      for (const statement of ancestor.body.slice(0, childIndex)) {
        if (!isNodeOfType(statement, "IfStatement") || statement.alternate) continue;
        const positiveTest = unwrapNegativeGuardForm(statement.test);
        if (!positiveTest || !isNodeOfType(positiveTest, "CallExpression")) continue;
        if (!isNodeOfType(positiveTest.callee, "MemberExpression")) continue;
        if (
          getStaticPropertyName(positiveTest.callee) !== "some" ||
          !areNodesLooselyEqual(positiveTest.callee.object, findReceiver) ||
          !areNodesLooselyEqual(positiveTest.arguments[0], findPredicate)
        ) {
          continue;
        }
        let didPushMatchingValue = false;
        walkAst(statement.consequent, (candidate) => {
          if (didPushMatchingValue || !isNodeOfType(candidate, "CallExpression")) return;
          if (!isNodeOfType(candidate.callee, "MemberExpression")) return;
          if (
            getStaticPropertyName(candidate.callee) !== "push" ||
            !areNodesLooselyEqual(candidate.callee.object, findReceiver)
          ) {
            return;
          }
          const pushedValue = candidate.arguments[0];
          if (!pushedValue || !isNodeOfType(pushedValue as EsTreeNode, "ObjectExpression")) return;
          didPushMatchingValue = (
            pushedValue as EsTreeNodeOfType<"ObjectExpression">
          ).properties.some(
            (property) =>
              isNodeOfType(property, "Property") &&
              !property.computed &&
              ((isNodeOfType(property.key, "Identifier") &&
                property.key.name === lookupParts.propertyName) ||
                (isNodeOfType(property.key, "Literal") &&
                  property.key.value === lookupParts.propertyName)) &&
              areNodesLooselyEqual(property.value, lookupParts.comparedValue),
          );
        });
        if (didPushMatchingValue) return true;
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const isDefinitelyNonNullishMapValue = (value: EsTreeNode | undefined): boolean => {
  if (!value) return false;
  const expression = stripParenExpression(value);
  if (isNodeOfType(expression, "Literal")) return expression.value !== null;
  if (
    isNodeOfType(expression, "ObjectExpression") ||
    isNodeOfType(expression, "ArrayExpression") ||
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression") ||
    isNodeOfType(expression, "ClassExpression") ||
    isNodeOfType(expression, "NewExpression") ||
    isNodeOfType(expression, "TemplateLiteral")
  ) {
    return true;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      isDefinitelyNonNullishMapValue(expression.consequent) &&
      isDefinitelyNonNullishMapValue(expression.alternate)
    );
  }
  return false;
};

const unwrapFalseBooleanGuard = (test: EsTreeNode): EsTreeNode | null => {
  const expression = stripParenExpression(test);
  if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "||") {
    return (
      unwrapFalseBooleanGuard(expression.left as EsTreeNode) ??
      unwrapFalseBooleanGuard(expression.right as EsTreeNode)
    );
  }
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    return stripParenExpression(expression.argument);
  }
  if (!isNodeOfType(expression, "BinaryExpression")) return null;
  const operandPairs: Array<[EsTreeNode, EsTreeNode]> = [
    [expression.left as EsTreeNode, expression.right as EsTreeNode],
    [expression.right as EsTreeNode, expression.left as EsTreeNode],
  ];
  for (const [candidateGuard, candidateBoolean] of operandPairs) {
    const booleanValue = stripParenExpression(candidateBoolean);
    if (!isNodeOfType(booleanValue, "Literal") || typeof booleanValue.value !== "boolean") continue;
    const comparisonProvesFalse =
      ((expression.operator === "===" || expression.operator === "==") &&
        booleanValue.value === false) ||
      ((expression.operator === "!==" || expression.operator === "!=") &&
        booleanValue.value === true);
    if (comparisonProvesFalse) return stripParenExpression(candidateGuard);
  }
  return null;
};

const isEnsureThenMapGet = (
  assertion: EsTreeNode,
  receiver: EsTreeNodeOfType<"Identifier">,
  lookupKey: EsTreeNode,
  context: RuleContext,
): boolean => {
  const stableLookupKey = stripParenExpression(lookupKey);
  if (!isNodeOfType(stableLookupKey, "Identifier") && !isNodeOfType(stableLookupKey, "Literal")) {
    return false;
  }
  const receiverSymbol = context.scopes.symbolFor(receiver);
  if (!receiverSymbol) return false;
  const receiverMatches = (candidate: EsTreeNode): boolean => {
    const target = stripParenExpression(candidate);
    return (
      isNodeOfType(target, "Identifier") &&
      context.scopes.symbolFor(target)?.id === receiverSymbol.id
    );
  };
  const lookupKeyExpression = stripParenExpression(lookupKey);
  const lookupKeySymbol = isNodeOfType(lookupKeyExpression, "Identifier")
    ? context.scopes.symbolFor(lookupKeyExpression)
    : null;

  let child = assertion;
  let ancestor = assertion.parent ?? null;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (isNodeOfType(ancestor, "BlockStatement")) {
      const childIndex = ancestor.body.findIndex((statement) => statement === child);
      for (const statement of ancestor.body.slice(0, childIndex)) {
        if (!isNodeOfType(statement, "IfStatement") || statement.alternate) continue;
        const missingKeyTest = unwrapFalseBooleanGuard(statement.test);
        if (
          !missingKeyTest ||
          !isNodeOfType(missingKeyTest, "CallExpression") ||
          !isNodeOfType(missingKeyTest.callee, "MemberExpression") ||
          getStaticPropertyName(missingKeyTest.callee) !== "has" ||
          !receiverMatches(missingKeyTest.callee.object) ||
          !areNodesLooselyEqual(missingKeyTest.arguments[0], lookupKey)
        ) {
          continue;
        }

        const populationCalls: EsTreeNodeOfType<"CallExpression">[] = [];
        walkAst(statement.consequent, (candidate) => {
          if (isFunctionLike(candidate)) return false;
          if (populationCalls.length > 0 || !isNodeOfType(candidate, "CallExpression")) return;
          if (!isNodeOfType(candidate.callee, "MemberExpression")) return;
          if (
            getStaticPropertyName(candidate.callee) === "set" &&
            receiverMatches(candidate.callee.object) &&
            areNodesLooselyEqual(candidate.arguments[0], lookupKey) &&
            isDefinitelyNonNullishMapValue(candidate.arguments[1]) &&
            isUnconditionallyBefore(candidate, assertion, statement.consequent)
          ) {
            populationCalls.push(candidate);
          }
        });
        const populationCall = populationCalls[0];
        if (!populationCall) continue;
        const populationCallStart = populationCall.range[0];

        const didWriteLookupKey = Boolean(
          lookupKeySymbol?.references.some(
            (reference) =>
              reference.flag !== "read" &&
              reference.identifier.range[0] > populationCallStart &&
              reference.identifier.range[0] < assertion.range[0],
          ),
        );
        if (didWriteLookupKey) continue;

        const didWriteReceiver = receiverSymbol.references.some(
          (reference) =>
            reference.flag !== "read" &&
            reference.identifier.range[0] > populationCallStart &&
            reference.identifier.range[0] < assertion.range[0],
        );
        if (didWriteReceiver) continue;

        const wasEntryInvalidated = indexedRelevantCalls(ancestor).some((laterCall) => {
          if (
            laterCall.range[0] <= populationCallStart ||
            laterCall.range[0] >= assertion.range[0] ||
            !isNodeOfType(laterCall.callee, "MemberExpression") ||
            !receiverMatches(laterCall.callee.object)
          ) {
            return false;
          }
          const laterMethodName = getStaticPropertyName(laterCall.callee);
          return (
            laterMethodName === "clear" ||
            (laterMethodName === "delete" &&
              areNodesLooselyEqual(laterCall.arguments[0], lookupKey))
          );
        });
        if (!wasEntryInvalidated) return true;
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const getPropertyName = (memberExpression: EsTreeNodeOfType<"MemberExpression">): string | null =>
  getStaticPropertyName(memberExpression);

const isPredicateArgument = (
  node: EsTreeNode | null | undefined,
  context: RuleContext,
): boolean => {
  if (!node) return false;
  const expression = stripParenExpression(node);
  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression")
  ) {
    return true;
  }
  if (!isNodeOfType(expression, "Identifier")) return false;
  if (expression.name === "Boolean" && context.scopes.isGlobalReference(expression)) return true;
  return Boolean(resolveExactLocalFunction(expression, context.scopes));
};

const literalValueKey = (node: EsTreeNode): string | null => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "Literal")) return null;
  if (
    typeof expression.value !== "string" &&
    typeof expression.value !== "number" &&
    typeof expression.value !== "boolean"
  ) {
    return null;
  }
  return `${typeof expression.value}:${String(expression.value)}`;
};

const collectLiteralUnionValues = (
  typeNode: EsTreeNode,
  context: RuleContext,
): Set<string> | null => {
  let expression = typeNode;
  if (expression.type === "TSTypeAnnotation" && "typeAnnotation" in expression) {
    expression = expression.typeAnnotation as EsTreeNode;
  }
  if (expression.type === "TSTypeReference" && "typeName" in expression) {
    const typeName = expression.typeName as EsTreeNode;
    if (!isNodeOfType(typeName, "Identifier")) return null;
    const typeSymbol = context.scopes.symbolFor(typeName);
    let declaration = typeSymbol?.declarationNode ?? null;
    if (!declaration) {
      const program = findProgramRoot(typeNode);
      declaration =
        program?.body.find(
          (candidate) =>
            candidate.type === "TSTypeAliasDeclaration" &&
            "id" in candidate &&
            isNodeOfType(candidate.id as EsTreeNode, "Identifier") &&
            candidate.id.name === typeName.name,
        ) ?? null;
    }
    if (
      !declaration ||
      declaration.type !== "TSTypeAliasDeclaration" ||
      !("typeAnnotation" in declaration)
    ) {
      return null;
    }
    expression = declaration.typeAnnotation as EsTreeNode;
  }
  const unionMembers =
    expression.type === "TSUnionType" && "types" in expression
      ? (expression.types as EsTreeNode[])
      : [expression];
  const values = new Set<string>();
  for (const member of unionMembers) {
    if (member.type !== "TSLiteralType" || !("literal" in member)) return null;
    const valueKey = literalValueKey(member.literal as EsTreeNode);
    if (!valueKey) return null;
    values.add(valueKey);
  }
  return values.size > 0 ? values : null;
};

const isExhaustiveLiteralTupleMapping = (
  findReceiver: EsTreeNode,
  findPredicate: EsTreeNode,
  context: RuleContext,
): boolean => {
  const receiver = stripParenExpression(findReceiver);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverSymbol = context.scopes.symbolFor(receiver);
  if (
    !receiverSymbol ||
    receiverSymbol.kind !== "const" ||
    receiverSymbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  const program = findProgramRoot(receiver);
  if (program && subtreeWritesSymbol(program, new Set([receiverSymbol.id]), context)) return false;
  const hasMutatingCall = receiverSymbol.references.some((reference) => {
    const member = reference.identifier.parent;
    const call = member?.parent;
    return Boolean(
      member &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === reference.identifier &&
      call &&
      isNodeOfType(call, "CallExpression") &&
      call.callee === member &&
      MUTATING_ARRAY_METHOD_NAMES.has(getStaticPropertyName(member) ?? ""),
    );
  });
  if (hasMutatingCall) return false;
  const table = receiverSymbol.initializer
    ? stripParenExpression(receiverSymbol.initializer)
    : null;
  if (!table || !isNodeOfType(table, "ArrayExpression") || table.elements.length === 0) {
    return false;
  }
  const lookup = findEqualityLookupParts(findPredicate);
  if (!lookup || lookup.propertyName !== "0") return false;
  const comparedValue = stripParenExpression(lookup.comparedValue);
  if (!isNodeOfType(comparedValue, "Identifier")) return false;
  const comparedSymbol = context.scopes.symbolFor(comparedValue);
  if (
    !comparedSymbol ||
    comparedSymbol.references.some((reference) => reference.flag !== "read") ||
    !("typeAnnotation" in comparedSymbol.bindingIdentifier) ||
    !comparedSymbol.bindingIdentifier.typeAnnotation
  ) {
    return false;
  }
  const expectedValues = collectLiteralUnionValues(
    comparedSymbol.bindingIdentifier.typeAnnotation as EsTreeNode,
    context,
  );
  if (!expectedValues) return false;
  const tableValues = new Set<string>();
  for (const element of table.elements) {
    const tuple = element ? stripParenExpression(element as EsTreeNode) : null;
    if (!tuple || !isNodeOfType(tuple, "ArrayExpression")) return false;
    const keyElement = tuple.elements[0];
    if (!keyElement) return false;
    const valueKey = literalValueKey(keyElement as EsTreeNode);
    if (!valueKey) return false;
    tableValues.add(valueKey);
  }
  return (
    tableValues.size === expectedValues.size &&
    [...expectedValues].every((value) => tableValues.has(value))
  );
};

export const noNonNullAssertionOnMaybeUndefinedResult = defineRule({
  id: "no-non-null-assertion-on-maybe-undefined-result",
  title: "Non-null assertion on a maybe-undefined result",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Drop the `!` on `.find`/`.match`/`.get` results and handle the miss (optional chaining, a guard, or a fallback). These built-ins return `undefined`/`null` when nothing matches, so the assertion just moves the crash one line later.",
  create: (context: RuleContext) => {
    const skipTestlikeFile = isTestlikeFilename(context.filename);
    return {
      TSNonNullExpression(node: EsTreeNodeOfType<"TSNonNullExpression">) {
        if (skipTestlikeFile) return;
        if (!isObjectOfMemberAccess(node as EsTreeNode)) return;
        const inner = stripParenExpression(node.expression as EsTreeNode);
        if (!isNodeOfType(inner, "CallExpression")) return;
        const callee = inner.callee;
        if (!isNodeOfType(callee, "MemberExpression")) return;
        const methodName = getStaticPropertyName(callee);
        if (!methodName) return;
        const message = NO_MATCH_MESSAGES[methodName];
        if (!message) return;

        const args = inner.arguments ?? [];
        if (methodName === "find" || methodName === "findLast") {
          const predicate = args[0] ? stripParenExpression(args[0]) : null;
          if (!isPredicateArgument(predicate, context)) return;
          const findReceiver = callee.object as EsTreeNode;
          if (predicate && isExhaustiveLiteralTupleMapping(findReceiver, predicate, context)) {
            return;
          }
          if (
            predicate &&
            scopeProvesFindMatch(node as EsTreeNode, findReceiver, predicate, context)
          ) {
            return;
          }
          if (predicate && isEnsureThenFind(node as EsTreeNode, findReceiver, predicate)) return;
        }
        if (methodName === "match") {
          const matchReceiver = callee.object as EsTreeNode;
          const pattern = args[0] ? stripParenExpression(args[0]) : null;
          if (
            pattern &&
            isNodeOfType(pattern, "Literal") &&
            "regex" in pattern &&
            isAlwaysMatchingRegexPattern(pattern.regex?.pattern, pattern.regex?.flags)
          ) {
            return;
          }
          const regexKey = pattern ? regexComparableKey(pattern, context) : null;
          if (
            pattern &&
            isGuardedAnchoredCharacterMatch(node as EsTreeNode, matchReceiver, pattern)
          ) {
            return;
          }
          if (
            pattern &&
            regexKey &&
            isMatchProvenByFindUpUntilPredicate(node as EsTreeNode, matchReceiver, pattern, context)
          ) {
            return;
          }
          if (
            regexKey &&
            scopeProvesMatchTested(node as EsTreeNode, regexKey, matchReceiver, context)
          ) {
            return;
          }
        }
        if (methodName === "get") {
          const key = args[0] ? stripParenExpression(args[0]) : null;
          if (!key) return;
          const receiver = stripParenExpression(callee.object as EsTreeNode);
          if (!isNodeOfType(receiver, "Identifier")) return;
          if (!scopeDeclaresEmptyMap(receiver, context)) return;
          if (scopeProvesKeyPresence(node, receiver, key, context)) return;
          if (isEnsureThenMapGet(node, receiver, key, context)) return;
        }

        context.report({ node, message });
      },
    };
  },
});
