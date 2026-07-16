import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isAlwaysMatchingRegexPattern } from "../../utils/is-always-matching-regex-pattern.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNonSourceFilename } from "../../utils/is-non-source-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { unwrapNegativeGuardForm } from "../../utils/unwrap-negative-guard-form.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const REGEX_RESULT_METHOD_NAMES = new Set(["exec", "match"]);
const TOUCH_LIST_PROPERTY_NAMES = new Set(["touches", "targetTouches"]);
const TOUCH_END_EVENT_NAMES = new Set(["touchend", "touchcancel"]);
const TOUCH_END_HANDLER_PROP_PATTERN = /^ontouch(?:end|cancel)$/i;

const MESSAGE =
  "This dereferences an array index result that can be undefined at runtime (empty list, no regex match, or a short split), which throws `Cannot read properties of undefined`. Guard with a length/emptiness check or optional chaining before the access.";

const isNumericLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "number";

// A call whose method is `.exec(...)` / `.match(...)` — the result is
// `null` on no match and each capture group can be undefined.
const isRegexResultCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.computed &&
  isNodeOfType(node.callee.property, "Identifier") &&
  REGEX_RESULT_METHOD_NAMES.has(node.callee.property.name);

const isSplitCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.computed &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === "split";

// `evt.touches` / `evt.targetTouches` — an empty TouchList inside
// touchend/touchcancel handlers.
const isTouchListAccess = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  TOUCH_LIST_PROPERTY_NAMES.has(node.property.name);

// True when the nearest enclosing function is wired to a
// `touchend`/`touchcancel` listener — the only touch phase where the
// TouchList is empty and `touches[0]` throws.
const isInsideTouchEndHandler = (node: EsTreeNode): boolean => {
  const handler = findEnclosingFunction(node);
  if (!handler) return false;
  const parent = handler.parent;
  if (!parent) return false;

  if (
    isNodeOfType(parent, "CallExpression") &&
    isNodeOfType(parent.callee, "MemberExpression") &&
    isNodeOfType(parent.callee.property, "Identifier") &&
    parent.callee.property.name === "addEventListener" &&
    parent.arguments[1] === handler
  ) {
    const eventNameArgument = parent.arguments[0];
    return (
      Boolean(eventNameArgument) &&
      isNodeOfType(eventNameArgument as EsTreeNode, "Literal") &&
      typeof (eventNameArgument as EsTreeNodeOfType<"Literal">).value === "string" &&
      TOUCH_END_EVENT_NAMES.has(String((eventNameArgument as EsTreeNodeOfType<"Literal">).value))
    );
  }

  if (
    isNodeOfType(parent, "JSXExpressionContainer") &&
    isNodeOfType(parent.parent, "JSXAttribute")
  ) {
    const attributeName = parent.parent.name;
    return (
      isNodeOfType(attributeName as EsTreeNode, "JSXIdentifier") &&
      TOUCH_END_HANDLER_PROP_PATTERN.test((attributeName as EsTreeNodeOfType<"JSXIdentifier">).name)
    );
  }

  if (isNodeOfType(parent, "Property") && isNodeOfType(parent.key, "Identifier")) {
    return TOUCH_END_HANDLER_PROP_PATTERN.test(parent.key.name);
  }

  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    isNodeOfType(parent.left, "MemberExpression") &&
    isNodeOfType(parent.left.property, "Identifier")
  ) {
    return TOUCH_END_HANDLER_PROP_PATTERN.test(parent.left.property.name);
  }

  return false;
};

// Structural equality for guard-shaped expressions (identifier / literal /
// member / call), with regex literals compared by raw source so
// `str.match(/x/) ? str.match(/x/)[1] : ...` recognizes both calls as the
// same read. Local (not the shared util) because the shared helper compares
// regex literals by RegExp object identity, which is never equal.
const areGuardExpressionsEqual = (
  first: EsTreeNode | null | undefined,
  second: EsTreeNode | null | undefined,
): boolean => {
  if (!first || !second) return false;
  if (first.type !== second.type) return false;
  if (isNodeOfType(first, "Identifier") && isNodeOfType(second, "Identifier")) {
    return first.name === second.name;
  }
  if (isNodeOfType(first, "Literal") && isNodeOfType(second, "Literal")) {
    if ("regex" in first || "regex" in second) return first.raw === second.raw;
    return first.value === second.value;
  }
  if (isNodeOfType(first, "MemberExpression") && isNodeOfType(second, "MemberExpression")) {
    return (
      first.computed === second.computed &&
      areGuardExpressionsEqual(first.object, second.object) &&
      areGuardExpressionsEqual(first.property, second.property)
    );
  }
  if (isNodeOfType(first, "CallExpression") && isNodeOfType(second, "CallExpression")) {
    if (!areGuardExpressionsEqual(first.callee, second.callee)) return false;
    if (first.arguments.length !== second.arguments.length) return false;
    return first.arguments.every((argument, argumentIndex) =>
      areGuardExpressionsEqual(argument, second.arguments[argumentIndex]),
    );
  }
  return false;
};

// Conditions that dominate the deref within the nearest enclosing function:
// tests of if/ternary consequents the deref sits in, left operands of `&&`
// chains it sits on the right of, negated tests of if/ternary ALTERNATES
// (`m === null ? fallback : m[1].trim()`), and negated tests of early-exit
// guards preceding the deref in the same block chain
// (`if (!raw.includes(':')) return; … raw.split(':')[1].trim()`).
const collectDominatingConditionTests = (node: EsTreeNode): EsTreeNode[] => {
  const dominatingTests: EsTreeNode[] = [];
  let cursor: EsTreeNode = node;
  let parent = cursor.parent ?? null;
  while (parent && !isFunctionLike(parent)) {
    if (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) {
      if (parent.consequent === cursor) dominatingTests.push(parent.test);
      if (parent.alternate === cursor) {
        const positiveGuard = unwrapNegativeGuardForm(parent.test);
        if (positiveGuard) dominatingTests.push(positiveGuard);
      }
    }
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === cursor
    ) {
      dominatingTests.push(parent.left);
    }
    if (isNodeOfType(parent, "BlockStatement")) {
      for (const statement of parent.body) {
        if (statement === cursor) break;
        if (
          isNodeOfType(statement, "IfStatement") &&
          !statement.alternate &&
          isEarlyExitStatement(statement.consequent)
        ) {
          const positiveGuard = unwrapNegativeGuardForm(statement.test);
          if (positiveGuard) dominatingTests.push(positiveGuard);
        }
      }
    }
    cursor = parent;
    parent = parent.parent ?? null;
  }
  return dominatingTests;
};

// A dominating test hoisted into a descriptively named boolean
// (`const hasScheme = url.includes('://')`) guards through the binding —
// resolve a bare identifier test to its declaration-time initializer.
const resolveTestExpression = (test: EsTreeNode): EsTreeNode => {
  const expression = stripParenExpression(test);
  if (isNodeOfType(expression, "Identifier")) {
    const binding = findVariableInitializer(expression, expression.name);
    if (binding?.initializer) return binding.initializer;
  }
  return expression;
};

const COERCION_CALLEE_NAMES = new Set(["String", "Number", "Boolean"]);

// Walks a value expression down to the identifier it reads from:
// `value.toString()` -> `value`, `currentUser.address` -> `currentUser`,
// `String(value)` -> `value`.
const findValueBaseIdentifier = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let cursor = stripParenExpression(node);
  while (!isNodeOfType(cursor, "Identifier")) {
    if (isNodeOfType(cursor, "CallExpression") && isNodeOfType(cursor.callee, "MemberExpression")) {
      cursor = stripParenExpression(cursor.callee.object);
      continue;
    }
    if (
      isNodeOfType(cursor, "CallExpression") &&
      isNodeOfType(cursor.callee, "Identifier") &&
      COERCION_CALLEE_NAMES.has(cursor.callee.name) &&
      cursor.arguments[0]
    ) {
      cursor = stripParenExpression(cursor.arguments[0] as EsTreeNode);
      continue;
    }
    if (isNodeOfType(cursor, "MemberExpression")) {
      cursor = stripParenExpression(cursor.object);
      continue;
    }
    return null;
  }
  return cursor;
};

// A same-file predicate helper invoked over the dereferenced value
// (`isNumber(value)` dominating `value.toString().split('.')[1]`, or over
// the member read itself — `isVersioned(props.value)`) — its body is
// invisible to intra-procedural analysis, so treat it as a guard the rule
// cannot refute.
const isPredicateCallOverValue = (
  call: EsTreeNodeOfType<"CallExpression">,
  valueExpression: EsTreeNode | null,
  baseIdentifier: EsTreeNodeOfType<"Identifier"> | null,
): boolean =>
  call.arguments.some((argument) => {
    const strippedArgument = stripParenExpression(argument as EsTreeNode);
    if (baseIdentifier && areGuardExpressionsEqual(strippedArgument, baseIdentifier)) return true;
    return Boolean(valueExpression) && areGuardExpressionsEqual(strippedArgument, valueExpression);
  });

const someDominatingTestHasCall = (
  node: EsTreeNode,
  isGuardCall: (call: EsTreeNodeOfType<"CallExpression">) => boolean,
): boolean =>
  collectDominatingConditionTests(node).some((test) => {
    let didFindGuardCall = false;
    walkAst(resolveTestExpression(test), (child: EsTreeNode) => {
      if (didFindGuardCall) return false;
      if (isNodeOfType(child, "CallExpression") && isGuardCall(child)) {
        didFindGuardCall = true;
        return false;
      }
    });
    return didFindGuardCall;
  });

// The double-read idiom `str.match(re) ? str.match(re)[1].trim() : ''` —
// a dominating condition repeats the same exec/match call, so the indexed
// read is proven non-null on this branch — or an opaque predicate call is
// made over the matched value (`isHex(color) ? color.match(re)[1] : ...`).
const isRegexResultDerefGuarded = (node: EsTreeNode, regexResultCall: EsTreeNode): boolean => {
  const matchedValueIdentifier =
    isNodeOfType(regexResultCall, "CallExpression") &&
    isNodeOfType(regexResultCall.callee, "MemberExpression") &&
    isNodeOfType(regexResultCall.callee.property, "Identifier")
      ? findValueBaseIdentifier(
          regexResultCall.callee.property.name === "exec"
            ? (regexResultCall.arguments[0] ?? regexResultCall.callee.object)
            : regexResultCall.callee.object,
        )
      : null;
  return someDominatingTestHasCall(
    node,
    (call) =>
      areGuardExpressionsEqual(call, regexResultCall) ||
      isPredicateCallOverValue(call, null, matchedValueIdentifier),
  );
};

const isAlwaysMatchRegexResult = (regexResultCall: EsTreeNode, partIndex: number): boolean => {
  if (partIndex !== 0) return false;
  if (!isNodeOfType(regexResultCall, "CallExpression")) return false;
  if (!isNodeOfType(regexResultCall.callee, "MemberExpression")) return false;
  if (!isNodeOfType(regexResultCall.callee.property, "Identifier")) return false;
  const regexOperand =
    regexResultCall.callee.property.name === "exec"
      ? stripParenExpression(regexResultCall.callee.object)
      : regexResultCall.arguments[0]
        ? stripParenExpression(regexResultCall.arguments[0] as EsTreeNode)
        : null;
  if (!regexOperand || !isNodeOfType(regexOperand, "Literal") || !("regex" in regexOperand)) {
    return false;
  }
  return isAlwaysMatchingRegexPattern(regexOperand.regex?.pattern);
};

// `"1.2.3".split(".")[1]` — splitting a string literal by a string-literal
// delimiter has a statically known part count.
const isStaticallyPresentSplitPart = (splitCall: EsTreeNode, partIndex: number): boolean => {
  if (!isNodeOfType(splitCall, "CallExpression")) return false;
  if (!isNodeOfType(splitCall.callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(splitCall.callee.object);
  const delimiter = splitCall.arguments[0];
  if (!isNodeOfType(receiver, "Literal") || typeof receiver.value !== "string") return false;
  if (!delimiter || !isNodeOfType(delimiter, "Literal") || typeof delimiter.value !== "string") {
    return false;
  }
  return receiver.value.split(delimiter.value).length > partIndex;
};

// A dominating condition that guarantees the delimiter exists before the
// split is read: `receiver.includes(delimiter)` on the same receiver and
// delimiter, a regex precondition via `.test(...)` over the same receiver
// or split value (the delimiter's presence is asserted by the pattern), or
// an opaque predicate call over the split value (`isNumber(value)` before
// `value.toString().split('.')[1]`).
const isSplitPartDerefGuarded = (node: EsTreeNode, splitCall: EsTreeNode): boolean => {
  if (!isNodeOfType(splitCall, "CallExpression")) return false;
  if (!isNodeOfType(splitCall.callee, "MemberExpression")) return false;
  const splitReceiver = stripParenExpression(splitCall.callee.object);
  const splitDelimiter = splitCall.arguments[0] ?? null;
  const splitValueIdentifier = findValueBaseIdentifier(splitReceiver);
  return someDominatingTestHasCall(node, (call) => {
    if (areGuardExpressionsEqual(call, splitCall)) return true;
    if (isPredicateCallOverValue(call, splitReceiver, splitValueIdentifier)) return true;
    if (!isNodeOfType(call.callee, "MemberExpression") || call.callee.computed) return false;
    if (!isNodeOfType(call.callee.property, "Identifier")) return false;
    const guardMethodName = call.callee.property.name;
    if (guardMethodName === "test") {
      const testedValue = call.arguments[0] ? stripParenExpression(call.arguments[0]) : null;
      if (!testedValue) return false;
      if (areGuardExpressionsEqual(testedValue, splitReceiver)) return true;
      const testedValueIdentifier = findValueBaseIdentifier(testedValue);
      return (
        testedValueIdentifier !== null &&
        areGuardExpressionsEqual(testedValueIdentifier, splitValueIdentifier)
      );
    }
    if (guardMethodName !== "includes" && guardMethodName !== "indexOf") return false;
    const guardArgument = call.arguments[0] ?? null;
    return (
      areGuardExpressionsEqual(stripParenExpression(call.callee.object), splitReceiver) &&
      areGuardExpressionsEqual(guardArgument, splitDelimiter)
    );
  });
};

// Producers with a statically known shape: `toISOString()` always contains
// `T`, `.`, `:` and `-` at fixed positions, and an http(s) document's
// `location.pathname` always starts with `/` (so `split('/')[1]` exists).
const isKnownFormatSplitPart = (splitCall: EsTreeNode, partIndex: number): boolean => {
  if (!isNodeOfType(splitCall, "CallExpression")) return false;
  if (!isNodeOfType(splitCall.callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(splitCall.callee.object);
  const delimiter = splitCall.arguments[0];
  const delimiterValue =
    delimiter && isNodeOfType(delimiter, "Literal") && typeof delimiter.value === "string"
      ? delimiter.value
      : null;
  if (delimiterValue === null) return false;
  if (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "MemberExpression") &&
    isNodeOfType(receiver.callee.property, "Identifier") &&
    receiver.callee.property.name === "toISOString"
  ) {
    if ((delimiterValue === "T" || delimiterValue === ".") && partIndex <= 1) return true;
    if ((delimiterValue === ":" || delimiterValue === "-") && partIndex <= 2) return true;
  }
  if (
    isNodeOfType(receiver, "MemberExpression") &&
    !receiver.computed &&
    isNodeOfType(receiver.property, "Identifier") &&
    receiver.property.name === "pathname" &&
    delimiterValue === "/" &&
    partIndex === 1
  ) {
    return true;
  }
  return false;
};

// `lines.filter(l => l.includes(':')).map(l => l.split(':')[1].trim())` —
// the deref sits in an iteration callback over a `.filter(...)`ed chain, so
// every element already passed the (opaque to us) filter predicate.
const ITERATION_CALLBACK_METHOD_NAMES = new Set(["map", "forEach", "flatMap"]);

const isInsideFilteredIterationCallback = (node: EsTreeNode, splitCall: EsTreeNode): boolean => {
  if (!isNodeOfType(splitCall, "CallExpression")) return false;
  if (!isNodeOfType(splitCall.callee, "MemberExpression")) return false;
  const splitValueIdentifier = findValueBaseIdentifier(
    stripParenExpression(splitCall.callee.object),
  );
  if (!splitValueIdentifier) return false;
  const callback = findEnclosingFunction(node);
  if (
    !callback ||
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression"))
  ) {
    return false;
  }
  const firstParameter = callback.params?.[0];
  if (
    !firstParameter ||
    !isNodeOfType(firstParameter, "Identifier") ||
    firstParameter.name !== splitValueIdentifier.name
  ) {
    return false;
  }
  const iterationCall = callback.parent;
  if (
    !iterationCall ||
    !isNodeOfType(iterationCall, "CallExpression") ||
    !isNodeOfType(iterationCall.callee, "MemberExpression") ||
    !isNodeOfType(iterationCall.callee.property, "Identifier") ||
    !ITERATION_CALLBACK_METHOD_NAMES.has(iterationCall.callee.property.name)
  ) {
    return false;
  }
  let receiver: EsTreeNode = stripParenExpression(iterationCall.callee.object);
  while (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "MemberExpression")
  ) {
    if (
      isNodeOfType(receiver.callee.property, "Identifier") &&
      receiver.callee.property.name === "filter"
    ) {
      return true;
    }
    receiver = stripParenExpression(receiver.callee.object);
  }
  return false;
};

// `e.touches.length` (or any read off the same TouchList) in a dominating
// condition proves the list non-empty on this branch.
const isTouchDerefGuarded = (node: EsTreeNode, touchListAccess: EsTreeNode): boolean =>
  collectDominatingConditionTests(node).some((test) => {
    let didFindTouchListRead = false;
    walkAst(resolveTestExpression(test), (child: EsTreeNode) => {
      if (didFindTouchListRead) return false;
      if (
        isNodeOfType(child, "MemberExpression") &&
        areGuardExpressionsEqual(stripParenExpression(child.object as EsTreeNode), touchListAccess)
      ) {
        didFindTouchListRead = true;
        return false;
      }
    });
    return didFindTouchListRead;
  });

// Flags an immediate deref (`.foo`, `.foo()`, further `[k]`) on the
// result of an empty-prone numeric bracket read with no dominating
// guard: (a) regex `.exec/.match` results, (b) `touches[0]` in
// touchend/touchcancel handlers, and (c) `.split(delim)[k]` for k>=1.
// Arithmetic indexing into parameter arrays is deliberately out of scope:
// caller-side index/length invariants (virtualized-grid cell renderers,
// reduce accumulators) make that pattern overwhelmingly safe in practice.
export const noArrayIndexDerefWithoutBoundsOrEmptyGuard = defineRule({
  id: "no-array-index-deref-without-bounds-or-empty-guard",
  title: "Array index result dereferenced without a guard",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "An array index read is typed `T` but is `T | undefined` at runtime, so dereferencing it on an empty list, a non-matching regex, or a short split throws. Add a length/emptiness check or optional chaining before the access.",
  create: (context: RuleContext): RuleVisitors => {
    const filename = context.filename ?? "";
    if (isNonSourceFilename(filename)) return {};

    return {
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        // The deref boundary itself is optional-chained — already null-safe.
        if (node.optional) return;

        const indexRead = stripParenExpression(node.object as EsTreeNode);
        if (!isNodeOfType(indexRead, "MemberExpression") || !indexRead.computed) return;
        // `base?.[i]` guards the base being nullish already.
        if (indexRead.optional) return;

        const base = stripParenExpression(indexRead.object as EsTreeNode);
        const index = indexRead.property as EsTreeNode;

        // (a) regex exec/match result indexed then dereferenced.
        if (isRegexResultCall(base)) {
          if (
            isNumericLiteral(index) &&
            isAlwaysMatchRegexResult(base, Number((index as EsTreeNodeOfType<"Literal">).value))
          ) {
            return;
          }
          if (isRegexResultDerefGuarded(node, base)) return;
          context.report({ node, message: MESSAGE });
          return;
        }

        // (c) `.split(delim)[k]` for k >= 1 (index 0 is always present).
        if (
          isSplitCall(base) &&
          isNumericLiteral(index) &&
          Number((index as EsTreeNodeOfType<"Literal">).value) >= 1
        ) {
          const partIndex = Number((index as EsTreeNodeOfType<"Literal">).value);
          if (isStaticallyPresentSplitPart(base, partIndex)) return;
          if (isKnownFormatSplitPart(base, partIndex)) return;
          if (isSplitPartDerefGuarded(node, base)) return;
          if (isInsideFilteredIterationCallback(node, base)) return;
          context.report({ node, message: MESSAGE });
          return;
        }

        // (b) `touches[0]` / `targetTouches[0]` inside touchend/touchcancel —
        // unless a dominating condition reads the same TouchList
        // (`e.touches.length`, a repeated `e.touches[0]` check), which is the
        // message's own remediation.
        if (isTouchListAccess(base) && isInsideTouchEndHandler(node)) {
          if (isTouchDerefGuarded(node, base)) return;
          context.report({ node, message: MESSAGE });
        }
      },
    };
  },
});
