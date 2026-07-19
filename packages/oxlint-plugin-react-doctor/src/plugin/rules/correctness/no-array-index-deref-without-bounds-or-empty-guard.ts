import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAlwaysMatchingRegexPattern } from "../../utils/is-always-matching-regex-pattern.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNonSourceFilename } from "../../utils/is-non-source-filename.js";
import { isPresenceProvenBeforeNode } from "../../utils/is-presence-proven-before-node.js";
import { singleExpressionPredicateBody } from "../../utils/single-expression-predicate-body.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { unwrapNegativeGuardForm } from "../../utils/unwrap-negative-guard-form.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const REGEX_RESULT_METHOD_NAMES = new Set(["exec", "match"]);
const TOUCH_LIST_PROPERTY_NAMES = new Set(["changedTouches", "touches", "targetTouches"]);
const TOUCH_END_EVENT_NAMES = new Set(["touchend", "touchcancel"]);
const TOUCH_END_HANDLER_PROP_PATTERN = /^ontouch(?:end|cancel)$/i;

const MESSAGE =
  "This dereferences an array index result that can be undefined at runtime (empty list, no regex match, or a short split), which throws `Cannot read properties of undefined`. Guard with a length/emptiness check or optional chaining before the access.";

const isNumericLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "number";

// A call whose method is `.exec(...)` / `.match(...)` — the result is
// `null` on no match and each capture group can be undefined.
const isRegexLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && "regex" in node;

const isRegexResultCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression")) {
    return false;
  }
  const methodName = getStaticPropertyName(node.callee);
  if (!methodName || !REGEX_RESULT_METHOD_NAMES.has(methodName)) return false;
  if (methodName === "exec") return isRegexLiteral(stripParenExpression(node.callee.object));
  const regexArgument = node.arguments[0];
  return Boolean(
    regexArgument && isRegexLiteral(stripParenExpression(regexArgument as EsTreeNode)),
  );
};

const isSplitCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  getStaticPropertyName(node.callee) === "split";

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
const isTouchEndListenerCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  handler: EsTreeNode,
): boolean => {
  if (
    !isNodeOfType(call.callee, "MemberExpression") ||
    getStaticPropertyName(call.callee) !== "addEventListener" ||
    call.arguments[1] !== handler
  ) {
    return false;
  }
  const eventNameArgument = call.arguments[0];
  return Boolean(
    eventNameArgument &&
    isNodeOfType(eventNameArgument as EsTreeNode, "Literal") &&
    typeof (eventNameArgument as EsTreeNodeOfType<"Literal">).value === "string" &&
    TOUCH_END_EVENT_NAMES.has(String((eventNameArgument as EsTreeNodeOfType<"Literal">).value)),
  );
};

const isInsideTouchEndHandler = (node: EsTreeNode, context: RuleContext): boolean => {
  const handler = findEnclosingFunction(node);
  if (!handler) return false;
  const parent = handler.parent;
  if (!parent) return false;

  if (isNodeOfType(parent, "CallExpression") && isTouchEndListenerCall(parent, handler))
    return true;

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

  const bindingIdentifier =
    isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")
      ? parent.id
      : (isNodeOfType(handler, "FunctionDeclaration") && handler.id) || null;
  const symbol = bindingIdentifier ? context.scopes.symbolFor(bindingIdentifier) : null;
  if (symbol) {
    return symbol.references.some((reference) => {
      const referenceParent = reference.identifier.parent;
      return Boolean(
        referenceParent &&
        isNodeOfType(referenceParent, "CallExpression") &&
        isTouchEndListenerCall(referenceParent, reference.identifier),
      );
    });
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

const testPositivelyHasCall = (
  test: EsTreeNode,
  isGuardCall: (call: EsTreeNodeOfType<"CallExpression">) => boolean,
): boolean => {
  const expression = resolveTestExpression(test);
  if (unwrapNegativeGuardForm(expression)) return false;
  if (isNodeOfType(expression, "LogicalExpression")) {
    if (expression.operator === "&&") {
      return (
        testPositivelyHasCall(expression.left as EsTreeNode, isGuardCall) ||
        testPositivelyHasCall(expression.right as EsTreeNode, isGuardCall)
      );
    }
    if (expression.operator === "||") {
      return (
        testPositivelyHasCall(expression.left as EsTreeNode, isGuardCall) &&
        testPositivelyHasCall(expression.right as EsTreeNode, isGuardCall)
      );
    }
  }
  let didFindGuardCall = false;
  walkAst(expression, (child: EsTreeNode) => {
    if (didFindGuardCall) return false;
    if (isNodeOfType(child, "CallExpression") && isGuardCall(child)) {
      didFindGuardCall = true;
      return false;
    }
  });
  return didFindGuardCall;
};

const someDominatingTestHasCall = (
  node: EsTreeNode,
  isGuardCall: (call: EsTreeNodeOfType<"CallExpression">) => boolean,
): boolean => isPresenceProvenBeforeNode(node, (test) => testPositivelyHasCall(test, isGuardCall));

// The double-read idiom `str.match(re) ? str.match(re)[1].trim() : ''` —
// a dominating condition repeats the same exec/match call, so the indexed
// read is proven non-null on this branch — or an opaque predicate call is
// made over the matched value (`isHex(color) ? color.match(re)[1] : ...`).
const regexPatternForResultCall = (regexResultCall: EsTreeNode): string | null => {
  if (!isNodeOfType(regexResultCall, "CallExpression")) return null;
  if (!isNodeOfType(regexResultCall.callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(regexResultCall.callee);
  const regexOperand =
    methodName === "exec"
      ? stripParenExpression(regexResultCall.callee.object)
      : regexResultCall.arguments[0]
        ? stripParenExpression(regexResultCall.arguments[0] as EsTreeNode)
        : null;
  return regexOperand && isNodeOfType(regexOperand, "Literal") && "regex" in regexOperand
    ? (regexOperand.regex?.pattern ?? null)
    : null;
};

const isCaptureDefinitelyPresent = (pattern: string, captureIndex: number): boolean => {
  if (captureIndex === 0) return true;
  let currentCaptureIndex = 0;
  let isEscaped = false;
  let isInsideCharacterClass = false;
  let targetGroupIds: number[] | null = null;
  const optionalGroupIds = new Set<number>();
  const groupIds: number[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (character === "\\") {
      isEscaped = true;
      continue;
    }
    if (character === "[") {
      isInsideCharacterClass = true;
      continue;
    }
    if (character === "]" && isInsideCharacterClass) {
      isInsideCharacterClass = false;
      continue;
    }
    if (isInsideCharacterClass) continue;
    if (character === "|") return false;
    if (character === "(") {
      const prefix = pattern.slice(index + 1, index + 4);
      const isCapturing =
        pattern[index + 1] !== "?" ||
        (prefix.startsWith("?<") && !prefix.startsWith("?<=") && !prefix.startsWith("?<!"));
      groupIds.push(index);
      if (isCapturing) {
        currentCaptureIndex += 1;
        if (currentCaptureIndex === captureIndex) targetGroupIds = [...groupIds];
      }
      continue;
    }
    if (character !== ")") continue;
    const closedGroupId = groupIds.pop();
    const following = pattern.slice(index + 1);
    if (following.startsWith("?") || following.startsWith("*") || /^\{0[,}]/.test(following)) {
      if (closedGroupId !== undefined) optionalGroupIds.add(closedGroupId);
    }
  }
  if (targetGroupIds === null) return false;
  return !targetGroupIds.some((groupId) => optionalGroupIds.has(groupId));
};

const isRegexResultDerefGuarded = (
  node: EsTreeNode,
  regexResultCall: EsTreeNode,
  partIndex: number,
): boolean => {
  const pattern = regexPatternForResultCall(regexResultCall);
  if (!pattern || !isCaptureDefinitelyPresent(pattern, partIndex)) return false;
  if (
    partIndex > 0 &&
    isNodeOfType(regexResultCall, "CallExpression") &&
    isNodeOfType(regexResultCall.callee, "MemberExpression") &&
    getStaticPropertyName(regexResultCall.callee) === "match"
  ) {
    const regexArgument = regexResultCall.arguments[0];
    const regexLiteral = regexArgument ? stripParenExpression(regexArgument as EsTreeNode) : null;
    if (
      regexLiteral &&
      isNodeOfType(regexLiteral, "Literal") &&
      "regex" in regexLiteral &&
      String(regexLiteral.regex?.flags ?? "").includes("g")
    ) {
      return false;
    }
  }
  return someDominatingTestHasCall(node, (call) => areGuardExpressionsEqual(call, regexResultCall));
};

const isAlwaysMatchRegexResult = (regexResultCall: EsTreeNode, partIndex: number): boolean => {
  if (partIndex !== 0) return false;
  if (!isNodeOfType(regexResultCall, "CallExpression")) return false;
  if (!isNodeOfType(regexResultCall.callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(regexResultCall.callee);
  if (!methodName) return false;
  const regexOperand =
    methodName === "exec"
      ? stripParenExpression(regexResultCall.callee.object)
      : regexResultCall.arguments[0]
        ? stripParenExpression(regexResultCall.arguments[0] as EsTreeNode)
        : null;
  if (!regexOperand || !isNodeOfType(regexOperand, "Literal") || !("regex" in regexOperand)) {
    return false;
  }
  return isAlwaysMatchingRegexPattern(regexOperand.regex?.pattern, regexOperand.regex?.flags);
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
  const partIndexExpression =
    isNodeOfType(node, "MemberExpression") && isNodeOfType(node.object, "MemberExpression")
      ? node.object.property
      : null;
  const partIndex =
    partIndexExpression && isNumericLiteral(partIndexExpression)
      ? Number((partIndexExpression as EsTreeNodeOfType<"Literal">).value)
      : null;
  return someDominatingTestHasCall(node, (call) => {
    if (areGuardExpressionsEqual(call, splitCall)) {
      if (partIndex === null) return false;
      const lengthRead = call.parent;
      if (
        !lengthRead ||
        !isNodeOfType(lengthRead, "MemberExpression") ||
        getStaticPropertyName(lengthRead) !== "length"
      ) {
        return false;
      }
      const comparison = lengthRead.parent;
      if (!comparison || !isNodeOfType(comparison, "BinaryExpression")) return false;
      const otherOperand = comparison.left === lengthRead ? comparison.right : comparison.left;
      if (!isNumericLiteral(otherOperand as EsTreeNode)) return false;
      const threshold = Number((otherOperand as EsTreeNodeOfType<"Literal">).value);
      if (comparison.left === lengthRead) {
        return (
          (comparison.operator === ">" && threshold >= partIndex) ||
          (comparison.operator === ">=" && threshold > partIndex)
        );
      }
      return (
        (comparison.operator === "<" && threshold >= partIndex) ||
        (comparison.operator === "<=" && threshold > partIndex)
      );
    }
    if (!isNodeOfType(call.callee, "MemberExpression")) return false;
    const guardMethodName = getStaticPropertyName(call.callee);
    if (guardMethodName === "test") {
      const testedValue = call.arguments[0] ? stripParenExpression(call.arguments[0]) : null;
      const regexReceiver = stripParenExpression(call.callee.object);
      if (!testedValue || !areGuardExpressionsEqual(testedValue, splitReceiver)) return false;
      if (!isNodeOfType(regexReceiver, "Literal") || !("regex" in regexReceiver)) return false;
      const delimiterValue =
        splitDelimiter &&
        isNodeOfType(splitDelimiter as EsTreeNode, "Literal") &&
        typeof (splitDelimiter as EsTreeNodeOfType<"Literal">).value === "string"
          ? String((splitDelimiter as EsTreeNodeOfType<"Literal">).value)
          : null;
      if (!delimiterValue) return false;
      const escapedDelimiter = delimiterValue.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
      const pattern = regexReceiver.regex?.pattern ?? "";
      if (pattern.includes("|") || pattern.includes("?") || pattern.includes("*")) return false;
      if (/\{0[,}]/.test(pattern)) return false;
      const delimiterIndex = pattern.indexOf(escapedDelimiter);
      if (delimiterIndex < 0) return false;
      const followingToken = pattern[delimiterIndex + escapedDelimiter.length];
      return followingToken !== "?" && followingToken !== "*";
    }
    if (guardMethodName !== "includes" && guardMethodName !== "indexOf") return false;
    const guardArgument = call.arguments[0] ?? null;
    if (
      !(
        areGuardExpressionsEqual(stripParenExpression(call.callee.object), splitReceiver) &&
        areGuardExpressionsEqual(guardArgument, splitDelimiter)
      )
    ) {
      return false;
    }
    if (guardMethodName === "includes") return true;
    const comparison = call.parent;
    if (!comparison || !isNodeOfType(comparison, "BinaryExpression")) return false;
    const otherOperand = comparison.left === call ? comparison.right : comparison.left;
    const unaryOperand = otherOperand as EsTreeNode;
    const isNegativeOne =
      isNodeOfType(unaryOperand, "UnaryExpression") &&
      unaryOperand.operator === "-" &&
      isNodeOfType(unaryOperand.argument, "Literal") &&
      unaryOperand.argument.value === 1;
    return (
      isNegativeOne &&
      (comparison.operator === "!==" ||
        comparison.operator === "!=" ||
        (comparison.left === call && comparison.operator === ">") ||
        (comparison.right === call && comparison.operator === "<"))
    );
  });
};

// Producers with a statically known shape: `toISOString()` always contains
// `T`, `.`, `:` and `-` at fixed positions, and an http(s) document's
// `location.pathname` always starts with `/` (so `split('/')[1]` exists).
const isKnownFormatSplitPart = (
  splitCall: EsTreeNode,
  partIndex: number,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(splitCall, "CallExpression")) return false;
  if (!isNodeOfType(splitCall.callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(splitCall.callee.object);
  const delimiter = splitCall.arguments[0];
  const delimiterValue =
    delimiter && isNodeOfType(delimiter, "Literal") && typeof delimiter.value === "string"
      ? delimiter.value
      : null;
  if (delimiterValue === null) return false;
  const dateReceiver =
    isNodeOfType(receiver, "CallExpression") && isNodeOfType(receiver.callee, "MemberExpression")
      ? stripParenExpression(receiver.callee.object)
      : null;
  if (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "MemberExpression") &&
    getStaticPropertyName(receiver.callee) === "toISOString" &&
    dateReceiver &&
    isNodeOfType(dateReceiver, "NewExpression") &&
    isNodeOfType(dateReceiver.callee, "Identifier") &&
    dateReceiver.callee.name === "Date" &&
    context.scopes.isGlobalReference(dateReceiver.callee)
  ) {
    if ((delimiterValue === "T" || delimiterValue === ".") && partIndex <= 1) return true;
    if ((delimiterValue === ":" || delimiterValue === "-") && partIndex <= 2) return true;
  }
  const pathnameObject = isNodeOfType(receiver, "MemberExpression")
    ? stripParenExpression(receiver.object)
    : null;
  if (
    isNodeOfType(receiver, "MemberExpression") &&
    !receiver.computed &&
    isNodeOfType(receiver.property, "Identifier") &&
    receiver.property.name === "pathname" &&
    pathnameObject &&
    isNodeOfType(pathnameObject, "MemberExpression") &&
    isNodeOfType(pathnameObject.object, "Identifier") &&
    pathnameObject.object.name === "window" &&
    context.scopes.isGlobalReference(pathnameObject.object) &&
    delimiterValue === "/" &&
    partIndex === 1
  ) {
    return true;
  }
  return false;
};

const ITERATION_CALLBACK_METHOD_NAMES = new Set(["map", "forEach", "flatMap"]);

const isInsideFilteredIterationCallback = (node: EsTreeNode, splitCall: EsTreeNode): boolean => {
  if (!isNodeOfType(splitCall, "CallExpression")) return false;
  if (!isNodeOfType(splitCall.callee, "MemberExpression")) return false;
  const splitReceiver = stripParenExpression(splitCall.callee.object);
  const splitValueIdentifier = isNodeOfType(splitReceiver, "Identifier") ? splitReceiver : null;
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
    if (getStaticPropertyName(receiver.callee) === "filter") {
      const filterCallback = receiver.arguments[0];
      const filterCallbackNode = filterCallback as EsTreeNode | undefined;
      if (
        !filterCallbackNode ||
        (!isNodeOfType(filterCallbackNode, "ArrowFunctionExpression") &&
          !isNodeOfType(filterCallbackNode, "FunctionExpression"))
      ) {
        return false;
      }
      const predicateBody = singleExpressionPredicateBody(filterCallbackNode);
      if (!predicateBody || !isNodeOfType(predicateBody, "CallExpression")) return false;
      if (!isNodeOfType(predicateBody.callee, "MemberExpression")) return false;
      if (getStaticPropertyName(predicateBody.callee) !== "includes") return false;
      const filterParameter = filterCallbackNode.params[0];
      return Boolean(
        filterParameter &&
        isNodeOfType(filterParameter, "Identifier") &&
        areGuardExpressionsEqual(predicateBody.callee.object, filterParameter) &&
        areGuardExpressionsEqual(predicateBody.arguments[0], splitCall.arguments[0]),
      );
    }
    receiver = stripParenExpression(receiver.callee.object);
  }
  return false;
};

// A positive `e.touches.length` check in a dominating condition proves the
// list non-empty on this branch. Normalized early-exit tests retain the
// original member parent, which distinguishes them from `if (e.touches)`.
const testPositivelyHasTouchRead = (test: EsTreeNode, touchListAccess: EsTreeNode): boolean => {
  const expression = resolveTestExpression(test);
  if (
    areGuardExpressionsEqual(expression, touchListAccess) &&
    expression.parent &&
    isNodeOfType(expression.parent, "MemberExpression") &&
    expression.parent.object === expression &&
    getStaticPropertyName(expression.parent) === "length"
  ) {
    return true;
  }
  if (unwrapNegativeGuardForm(expression)) return false;
  if (isNodeOfType(expression, "LogicalExpression")) {
    if (expression.operator === "&&") {
      return (
        testPositivelyHasTouchRead(expression.left as EsTreeNode, touchListAccess) ||
        testPositivelyHasTouchRead(expression.right as EsTreeNode, touchListAccess)
      );
    }
    if (expression.operator === "||") {
      return (
        testPositivelyHasTouchRead(expression.left as EsTreeNode, touchListAccess) &&
        testPositivelyHasTouchRead(expression.right as EsTreeNode, touchListAccess)
      );
    }
  }
  const readLength = (candidate: EsTreeNode): EsTreeNodeOfType<"MemberExpression"> | null => {
    const target = stripParenExpression(candidate);
    return isNodeOfType(target, "MemberExpression") &&
      getStaticPropertyName(target) === "length" &&
      areGuardExpressionsEqual(stripParenExpression(target.object as EsTreeNode), touchListAccess)
      ? target
      : null;
  };
  if (readLength(expression)) return true;
  if (!isNodeOfType(expression, "BinaryExpression")) return false;
  const operandPairs: Array<[EsTreeNode, EsTreeNode, boolean]> = [
    [expression.left as EsTreeNode, expression.right as EsTreeNode, true],
    [expression.right as EsTreeNode, expression.left as EsTreeNode, false],
  ];
  for (const [candidateLength, candidateThreshold, isLengthOnLeft] of operandPairs) {
    if (!readLength(candidateLength)) continue;
    const threshold = stripParenExpression(candidateThreshold);
    if (!isNumericLiteral(threshold)) continue;
    const thresholdValue = Number((threshold as EsTreeNodeOfType<"Literal">).value);
    if (
      (isLengthOnLeft &&
        ((expression.operator === ">" && thresholdValue >= 0) ||
          (expression.operator === ">=" && thresholdValue >= 1))) ||
      (!isLengthOnLeft &&
        ((expression.operator === "<" && thresholdValue >= 0) ||
          (expression.operator === "<=" && thresholdValue >= 1))) ||
      ((expression.operator === "!==" || expression.operator === "!=") && thresholdValue === 0)
    ) {
      return true;
    }
  }
  return false;
};

const isTouchDerefGuarded = (node: EsTreeNode, touchListAccess: EsTreeNode): boolean =>
  isPresenceProvenBeforeNode(node, (test) => testPositivelyHasTouchRead(test, touchListAccess));

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
          const partIndex = isNumericLiteral(index)
            ? Number((index as EsTreeNodeOfType<"Literal">).value)
            : -1;
          if (partIndex >= 0 && isRegexResultDerefGuarded(node, base, partIndex)) return;
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
          if (isKnownFormatSplitPart(base, partIndex, context)) return;
          if (isSplitPartDerefGuarded(node, base)) return;
          if (isInsideFilteredIterationCallback(node, base)) return;
          context.report({ node, message: MESSAGE });
          return;
        }

        // (b) `touches[0]` / `targetTouches[0]` inside touchend/touchcancel —
        // unless a dominating condition reads the same TouchList
        // (`e.touches.length`, a repeated `e.touches[0]` check), which is the
        // message's own remediation.
        if (isTouchListAccess(base) && isInsideTouchEndHandler(node, context)) {
          if (isTouchDerefGuarded(node, base)) return;
          context.report({ node, message: MESSAGE });
        }
      },
    };
  },
});
