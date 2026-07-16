import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingDeclarator } from "../../utils/find-enclosing-declarator.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isAlwaysMatchingRegexPattern } from "../../utils/is-always-matching-regex-pattern.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isObjectOfMemberAccess } from "../../utils/is-object-of-member-access.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { singleExpressionPredicateBody } from "../../utils/single-expression-predicate-body.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
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
const KEY_PRESENCE_METHOD_NAMES = new Set(["set", "has", "keys", "entries", "forEach"]);

// A `map.get(key)!` is likely safe when the same map is populated or
// checked (`map.set(...)` / `map.has(...)`), iterated by its own keys, or
// passed as an argument to a helper (which may populate it) somewhere in
// the enclosing scope, so abstain there — a false negative is preferable
// to a false positive. Matches `this.updateCallbacks`-style member
// receivers too, not just bare identifiers.
const scopeProvesKeyPresence = (assertion: EsTreeNode, receiverKey: string): boolean => {
  const scope = findOutermostScope(assertion);
  if (!scope) return false;
  let proven = false;
  walkAst(scope, (child) => {
    if (proven) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      KEY_PRESENCE_METHOD_NAMES.has(callee.property.name) &&
      receiverPathKey(callee.object as EsTreeNode) === receiverKey
    ) {
      proven = true;
      return false;
    }
    if (
      (child.arguments ?? []).some(
        (argument) => receiverPathKey(stripParenExpression(argument as EsTreeNode)) === receiverKey,
      )
    ) {
      proven = true;
      return false;
    }
  });
  return proven;
};

// The `get` branch only fires when the map's emptiness at construction is
// provable in scope: the receiver must be a local variable initialized with
// a bare `new Map()` / `new WeakMap()` (no entries argument). Parameters,
// call-initialized variables (`const sides = assignSides(...)`), `new
// Map(entries)` lookups, `this.*` fields, and unresolvable receivers all
// carry cross-function population invariants the rule cannot see, so they
// abstain.
const isBareMapConstruction = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  const target = stripParenExpression(node);
  return (
    isNodeOfType(target, "NewExpression") &&
    isNodeOfType(target.callee, "Identifier") &&
    (target.callee.name === "Map" || target.callee.name === "WeakMap") &&
    target.arguments.length === 0
  );
};

const scopeDeclaresEmptyMap = (assertion: EsTreeNode, receiverName: string): boolean => {
  const scope = findOutermostScope(assertion);
  if (!scope) return false;
  let didFindDeclaration = false;
  walkAst(scope, (child) => {
    if (didFindDeclaration) return false;
    if (!isNodeOfType(child, "VariableDeclarator")) return;
    if (!isNodeOfType(child.id, "Identifier") || child.id.name !== receiverName) return;
    if (isBareMapConstruction(child.init ? (child.init as EsTreeNode) : null)) {
      didFindDeclaration = true;
      return false;
    }
  });
  return didFindDeclaration;
};

// Normalize the regex a `.match(...)` receives so it can be compared with
// the receiver of a `.test(...)` call: same identifier, a member chain
// (`this.pattern`), or a regex literal with the same pattern. The `g`/`y`
// flags are dropped from the key — `/x/.test(s)` proves `s.match(/x/g)`
// returns a non-empty array — while semantic flags (`i`, `m`, `s`, `u`)
// must agree for the proof to hold.
const regexComparableKey = (node: EsTreeNode): string | null => {
  const target = stripParenExpression(node);
  if (isNodeOfType(target, "Identifier")) return `id:${target.name}`;
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
const TRANSPARENT_TEST_WRAPPER_TYPES = new Set<string>(["ParenthesizedExpression"]);

const isInBooleanTestPosition = (node: EsTreeNode): boolean => {
  let child: EsTreeNode = node;
  let parent = child.parent ?? null;
  while (parent) {
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") return true;
    if (
      isNodeOfType(parent, "LogicalExpression") ||
      TRANSPARENT_TEST_WRAPPER_TYPES.has(parent.type) ||
      isNodeOfType(parent, "ChainExpression")
    ) {
      child = parent;
      parent = parent.parent ?? null;
      continue;
    }
    if (
      isNodeOfType(parent, "IfStatement") ||
      isNodeOfType(parent, "ConditionalExpression") ||
      isNodeOfType(parent, "WhileStatement") ||
      isNodeOfType(parent, "DoWhileStatement")
    ) {
      return (parent as { test?: EsTreeNode }).test === child;
    }
    return false;
  }
  return false;
};

// `str.match(re)!` is likely on a proven-matching path when the enclosing
// scope also runs `re.test(...)` (validate-then-extract) or guards on
// another `.match(...)` of the same regex in boolean-test position
// (`if (!line.match(re)) return null; line.match(re)![1]`, or a
// `findUpUntil(el, (n) => !!n.className.match(re))` predicate whose hit
// is re-matched on the next line), so abstain.
const scopeProvesMatchTested = (assertion: EsTreeNode, regexKey: string): boolean => {
  const scope = findOutermostScope(assertion);
  if (!scope) return false;
  let proven = false;
  walkAst(scope, (child) => {
    if (proven) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      !isNodeOfType(callee.property, "Identifier")
    ) {
      return;
    }
    if (
      callee.property.name === "test" &&
      regexComparableKey(callee.object as EsTreeNode) === regexKey
    ) {
      proven = true;
      return false;
    }
    if (
      callee.property.name === "match" &&
      child.arguments?.[0] &&
      regexComparableKey(child.arguments[0] as EsTreeNode) === regexKey &&
      isInBooleanTestPosition(child)
    ) {
      proven = true;
      return false;
    }
  });
  return proven;
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
): boolean => {
  const scope = findOutermostScope(assertion);
  if (!scope) return false;
  let proven = false;
  walkAst(scope, (child) => {
    if (proven) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      !isNodeOfType(callee.property, "Identifier")
    ) {
      return;
    }
    const methodName = callee.property.name;
    if (
      (methodName === "some" || methodName === "findIndex") &&
      areNodesLooselyEqual(
        stripParenExpression(callee.object as EsTreeNode),
        stripParenExpression(findReceiver),
      ) &&
      areNodesLooselyEqual(
        child.arguments?.[0] ? stripParenExpression(child.arguments[0] as EsTreeNode) : null,
        stripParenExpression(findPredicate),
      )
    ) {
      proven = true;
      return false;
    }
    if (methodName === "includes") {
      const includesReceiver = stripParenExpression(callee.object as EsTreeNode);
      if (!isNodeOfType(includesReceiver, "Identifier")) return;
      const binding = findVariableInitializer(includesReceiver, includesReceiver.name);
      const initializer = binding?.initializer ? stripParenExpression(binding.initializer) : null;
      if (
        initializer &&
        isNodeOfType(initializer, "CallExpression") &&
        isNodeOfType(initializer.callee, "MemberExpression") &&
        getPropertyName(initializer.callee) === "map" &&
        areNodesLooselyEqual(
          stripParenExpression(initializer.callee.object as EsTreeNode),
          stripParenExpression(findReceiver),
        )
      ) {
        proven = true;
        return false;
      }
    }
  });
  return proven;
};

const getPropertyName = (memberExpression: EsTreeNodeOfType<"MemberExpression">): string | null =>
  !memberExpression.computed && isNodeOfType(memberExpression.property, "Identifier")
    ? memberExpression.property.name
    : null;

// `BREAKPOINT_MAPPING.find((bp) => bp[0] === breakpoint)![1]` — a receiver
// resolving to a const array-literal lookup table encodes its coverage at
// construction (a typed union maps to exhaustive entries), so the `!`
// asserts a construction invariant the rule cannot refute; abstain.
const isConstArrayLiteralReceiver = (receiver: EsTreeNode): boolean => {
  const target = stripParenExpression(receiver);
  if (!isNodeOfType(target, "Identifier")) return false;
  const binding = findVariableInitializer(target, target.name);
  if (!binding?.initializer) return false;
  const initializer = stripParenExpression(binding.initializer);
  if (!isNodeOfType(initializer, "ArrayExpression") || initializer.elements.length === 0) {
    return false;
  }
  const declarator = findEnclosingDeclarator(binding.bindingIdentifier);
  if (!declarator || declarator.id !== binding.bindingIdentifier) return false;
  const declaration = declarator.parent;
  return Boolean(
    declaration && isNodeOfType(declaration, "VariableDeclaration") && declaration.kind === "const",
  );
};

// `rows.find((r) => r.id === id1)!` right after `if (rows.length !== 2)
// throw ...` — a preceding early-exit guard on the receiver's `.length`
// pins the collection's contents before the lookup, so the assertion
// encodes a checked invariant; abstain.
const subtreeReadsReceiverLength = (node: EsTreeNode, receiverKey: string): boolean => {
  let found = false;
  walkAst(node, (child) => {
    if (found) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.property, "Identifier") &&
      child.property.name === "length" &&
      receiverPathKey(child.object as EsTreeNode) === receiverKey
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const isGuardedByPrecedingReceiverLengthExit = (
  assertion: EsTreeNode,
  findReceiver: EsTreeNode,
): boolean => {
  const receiverKey = receiverPathKey(findReceiver);
  if (!receiverKey) return false;
  let child: EsTreeNode = assertion;
  let ancestor: EsTreeNode | null = assertion.parent ?? null;
  while (ancestor) {
    if (isFunctionLike(ancestor)) return false;
    if (isNodeOfType(ancestor, "BlockStatement")) {
      for (const statement of ancestor.body) {
        if (statement === child) break;
        if (
          isNodeOfType(statement, "IfStatement") &&
          isEarlyExitStatement(statement.consequent) &&
          subtreeReadsReceiverLength(statement.test, receiverKey)
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

// `options.find((o) => o.value === property)!` where the same scope also
// projects the searched collection (`options.filter(...)` /
// `options.map(...)`): the compared key is drawn from the collection
// itself (Select options, visible-column subsets), so the equality lookup
// cannot miss by construction; abstain.
const COLLECTION_PROJECTION_METHOD_NAMES = new Set(["map", "filter"]);

const isEqualityLookupPredicate = (predicate: EsTreeNode): boolean => {
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
  return sidePairs.some(([elementKeyRead, comparedValue]) => {
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
};

const scopeProjectsFindReceiver = (assertion: EsTreeNode, findReceiver: EsTreeNode): boolean => {
  const scope = findOutermostScope(assertion);
  if (!scope) return false;
  const receiverTrailingName = isNodeOfType(findReceiver, "Identifier")
    ? findReceiver.name
    : isNodeOfType(findReceiver, "MemberExpression")
      ? getPropertyName(findReceiver)
      : null;
  let found = false;
  walkAst(scope, (child) => {
    if (found) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      !isNodeOfType(callee.property, "Identifier") ||
      !COLLECTION_PROJECTION_METHOD_NAMES.has(callee.property.name) ||
      (child.arguments?.length ?? 0) === 0
    ) {
      return;
    }
    const projectionReceiver = stripParenExpression(callee.object as EsTreeNode);
    if (
      areNodesLooselyEqual(projectionReceiver, stripParenExpression(findReceiver)) ||
      (receiverTrailingName !== null &&
        isNodeOfType(projectionReceiver, "Identifier") &&
        projectionReceiver.name === receiverTrailingName)
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// `value.toString().match(/^-?\d+/)![0]` — a receiver that is the value's
// own string projection (`x.toString()` / `String(x)`) carries a format
// the author controls, so whether the regex can miss is a value-range
// question the rule cannot model; abstain.
const isOwnStringProjectionReceiver = (matchReceiver: EsTreeNode): boolean => {
  const target = stripParenExpression(matchReceiver);
  if (!isNodeOfType(target, "CallExpression")) return false;
  const callee = stripParenExpression(target.callee as EsTreeNode);
  if (isNodeOfType(callee, "Identifier")) return callee.name === "String";
  return isNodeOfType(callee, "MemberExpression") && getPropertyName(callee) === "toString";
};

const isPredicateArgument = (node: EsTreeNode | null | undefined): boolean =>
  Boolean(
    node &&
    (isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression")),
  );

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
        if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
        if (!isNodeOfType(callee.property, "Identifier")) return;
        const methodName = callee.property.name;
        const message = NO_MATCH_MESSAGES[methodName];
        if (!message) return;

        const args = inner.arguments ?? [];
        if (methodName === "find" || methodName === "findLast") {
          const predicate = args[0] ? stripParenExpression(args[0]) : null;
          if (!isPredicateArgument(predicate)) return;
          const findReceiver = callee.object as EsTreeNode;
          if (isConstArrayLiteralReceiver(findReceiver)) return;
          if (isGuardedByPrecedingReceiverLengthExit(node as EsTreeNode, findReceiver)) return;
          if (
            predicate &&
            isEqualityLookupPredicate(predicate) &&
            scopeProjectsFindReceiver(node as EsTreeNode, stripParenExpression(findReceiver))
          ) {
            return;
          }
          if (predicate && scopeProvesFindMatch(node as EsTreeNode, findReceiver, predicate)) {
            return;
          }
        }
        if (methodName === "match") {
          if (isOwnStringProjectionReceiver(callee.object as EsTreeNode)) return;
          const pattern = args[0] ? stripParenExpression(args[0]) : null;
          if (
            pattern &&
            isNodeOfType(pattern, "Literal") &&
            "regex" in pattern &&
            isAlwaysMatchingRegexPattern(pattern.regex?.pattern)
          ) {
            return;
          }
          const regexKey = pattern ? regexComparableKey(pattern) : null;
          if (regexKey && scopeProvesMatchTested(node as EsTreeNode, regexKey)) return;
        }
        if (methodName === "get") {
          const key = args[0] ? stripParenExpression(args[0]) : null;
          // A static literal key is often known-present; only dynamic keys
          // carry real miss risk.
          if (!key || isNodeOfType(key, "Literal")) return;
          const receiver = stripParenExpression(callee.object as EsTreeNode);
          if (!isNodeOfType(receiver, "Identifier")) return;
          if (!scopeDeclaresEmptyMap(node as EsTreeNode, receiver.name)) return;
          if (scopeProvesKeyPresence(node as EsTreeNode, receiver.name)) return;
        }

        context.report({ node, message });
      },
    };
  },
});
