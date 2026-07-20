import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "Coercing an input's value with this parse stores `0` for a cleared field and `NaN` for partial input, which then flows into state or a request body; guard the empty and NaN cases (for example `value ? Number(value) : undefined`) before using it.";

const EVENT_VALUE_PROPERTIES: ReadonlySet<string> = new Set(["value", "valueAsNumber"]);
const EVENT_TARGET_PROPERTIES: ReadonlySet<string> = new Set(["target", "currentTarget"]);
const HANDLER_ATTRIBUTE_PATTERN = /^on[A-Z]/;
const NAN_GUARD_FUNCTION_NAMES: ReadonlySet<string> = new Set(["isNaN", "isFinite"]);

const FIXED_VALUE_INPUT_TYPES: ReadonlySet<string> = new Set(["checkbox", "radio"]);

interface NumericHandlerAnalysis {
  readonly nanGuardCallsBySymbolId: Map<number, EsTreeNodeOfType<"CallExpression">[]>;
}

const isNumericParseCallee = (callee: EsTreeNode, context: RuleContext): boolean => {
  const unwrappedCallee = stripParenExpression(callee);
  if (
    isNodeOfType(unwrappedCallee, "Identifier") &&
    (unwrappedCallee.name === "Number" ||
      unwrappedCallee.name === "parseInt" ||
      unwrappedCallee.name === "parseFloat") &&
    context.scopes.isGlobalReference(unwrappedCallee)
  ) {
    return true;
  }
  if (!isNodeOfType(unwrappedCallee, "MemberExpression")) return false;
  const receiver = stripParenExpression(unwrappedCallee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "Number" &&
    context.scopes.isGlobalReference(receiver) &&
    (getStaticPropertyName(unwrappedCallee) === "parseInt" ||
      getStaticPropertyName(unwrappedCallee) === "parseFloat")
  );
};

// Returns the root identifier name (the event parameter, e.g. `e`) when
// `argument` is an event-input value read: `e.target.value`,
// `e.currentTarget.value`, `e.target.valueAsNumber`. Otherwise null.
const getEventValueRoot = (argument: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  const valueAccess = stripParenExpression(argument);
  if (
    !isNodeOfType(valueAccess, "MemberExpression") ||
    !EVENT_VALUE_PROPERTIES.has(getStaticPropertyName(valueAccess) ?? "")
  ) {
    return null;
  }
  const targetAccess = stripParenExpression(valueAccess.object);
  if (
    !isNodeOfType(targetAccess, "MemberExpression") ||
    !EVENT_TARGET_PROPERTIES.has(getStaticPropertyName(targetAccess) ?? "")
  ) {
    return null;
  }
  const root = stripParenExpression(targetAccess.object);
  return isNodeOfType(root, "Identifier") ? root : null;
};

const nanGuardCoversEmptyInput = (
  call: EsTreeNodeOfType<"CallExpression">,
  argument: EsTreeNode,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(call.callee);
  const valueAccess = stripParenExpression(argument);
  return !(
    isNodeOfType(callee, "Identifier") &&
    callee.name === "Number" &&
    context.scopes.isGlobalReference(callee) &&
    isNodeOfType(valueAccess, "MemberExpression") &&
    getStaticPropertyName(valueAccess) === "value"
  );
};

const findEnclosingHandler = (call: EsTreeNode): EsTreeNode | null => {
  let ancestor = call.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const isNanGuardCall = (
  node: EsTreeNode,
  context: RuleContext,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return NAN_GUARD_FUNCTION_NAMES.has(callee.name) && context.scopes.isGlobalReference(callee);
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  const methodName = getStaticPropertyName(callee) ?? "";
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "Number" &&
    context.scopes.isGlobalReference(receiver) &&
    (NAN_GUARD_FUNCTION_NAMES.has(methodName) || methodName === "isInteger")
  );
};

const directlyExits = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (!isNodeOfType(statement, "BlockStatement")) return false;
  const finalStatement = statement.body.at(-1);
  return Boolean(
    finalStatement &&
    (isNodeOfType(finalStatement, "ReturnStatement") ||
      isNodeOfType(finalStatement, "ThrowStatement")),
  );
};

const guardCallReferencesBinding = (
  guardCall: EsTreeNodeOfType<"CallExpression">,
  bindingIdentifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  const expectedSymbol = context.scopes.symbolFor(bindingIdentifier);
  if (!expectedSymbol) return false;
  let didReference = false;
  for (const argument of guardCall.arguments) {
    walkAst(argument as EsTreeNode, (child: EsTreeNode) => {
      if (
        isNodeOfType(child, "Identifier") &&
        context.scopes.symbolFor(child)?.id === expectedSymbol.id
      ) {
        didReference = true;
        return false;
      }
    });
    if (didReference) return true;
  }
  return false;
};

const guardProtectsEveryUse = (
  guardCall: EsTreeNodeOfType<"CallExpression">,
  bindingIdentifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(bindingIdentifier);
  if (!symbol) return false;
  const callee = stripParenExpression(guardCall.callee);
  let methodName: string | null = null;
  if (isNodeOfType(callee, "Identifier")) methodName = callee.name;
  else if (isNodeOfType(callee, "MemberExpression")) methodName = getStaticPropertyName(callee);
  if (!methodName) return false;
  let testExpression = findTransparentExpressionRoot(guardCall);
  let validWhenTestTruthy = methodName !== "isNaN";
  if (
    testExpression.parent &&
    isNodeOfType(testExpression.parent, "UnaryExpression") &&
    testExpression.parent.operator === "!"
  ) {
    testExpression = testExpression.parent;
    validWhenTestTruthy = !validWhenTestTruthy;
  }
  const guardParent = testExpression.parent;
  if (
    (!isNodeOfType(guardParent, "IfStatement") &&
      !isNodeOfType(guardParent, "ConditionalExpression")) ||
    guardParent.test !== testExpression
  ) {
    return false;
  }
  const valueReferences = symbol.references.filter(
    (reference) =>
      reference.flag === "read" &&
      reference.identifier.range[0] > bindingIdentifier.range[1] &&
      !isAstDescendant(reference.identifier, testExpression),
  );
  if (validWhenTestTruthy) {
    return (
      valueReferences.length > 0 &&
      valueReferences.every((reference) =>
        isAstDescendant(reference.identifier, guardParent.consequent),
      )
    );
  }
  if (!isNodeOfType(guardParent, "IfStatement") || !directlyExits(guardParent.consequent)) {
    return false;
  }
  return valueReferences.every((reference) => reference.identifier.range[0] > guardParent.range[1]);
};

const isSameBinding = (
  leftIdentifier: EsTreeNode,
  rightIdentifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  const leftSymbol = context.scopes.symbolFor(leftIdentifier);
  const rightSymbol = context.scopes.symbolFor(rightIdentifier);
  return Boolean(leftSymbol && rightSymbol && leftSymbol.id === rightSymbol.id);
};

const isSameEventValueAccess = (
  candidate: EsTreeNode,
  eventRoot: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const candidateRoot = getEventValueRoot(candidate);
  return Boolean(candidateRoot && isSameBinding(candidateRoot, eventRoot, context));
};

const branchProvesEventValueState = (
  rawTest: EsTreeNode,
  eventRoot: EsTreeNodeOfType<"Identifier">,
  branchWhenTruthy: boolean,
  expectedNonEmpty: boolean,
  nanGuardProvesNonEmpty: boolean,
  context: RuleContext,
): boolean => {
  const test = stripParenExpression(rawTest);
  if (isSameEventValueAccess(test, eventRoot, context)) {
    return branchWhenTruthy === expectedNonEmpty;
  }
  if (isNodeOfType(test, "UnaryExpression") && test.operator === "!") {
    return branchProvesEventValueState(
      test.argument,
      eventRoot,
      !branchWhenTruthy,
      expectedNonEmpty,
      nanGuardProvesNonEmpty,
      context,
    );
  }
  if (isNodeOfType(test, "LogicalExpression")) {
    if (
      (branchWhenTruthy && test.operator === "&&") ||
      (!branchWhenTruthy && test.operator === "||")
    ) {
      return (
        branchProvesEventValueState(
          test.left,
          eventRoot,
          branchWhenTruthy,
          expectedNonEmpty,
          nanGuardProvesNonEmpty,
          context,
        ) ||
        branchProvesEventValueState(
          test.right,
          eventRoot,
          branchWhenTruthy,
          expectedNonEmpty,
          nanGuardProvesNonEmpty,
          context,
        )
      );
    }
    return false;
  }
  if (isNanGuardCall(test, context)) {
    if (!expectedNonEmpty) return false;
    const callee = stripParenExpression(test.callee);
    let guardName: string | null = null;
    if (isNodeOfType(callee, "Identifier")) guardName = callee.name;
    else if (isNodeOfType(callee, "MemberExpression")) {
      guardName = getStaticPropertyName(callee);
    }
    const guardedEventValue = test.arguments.some(
      (argument) =>
        !isNodeOfType(argument, "SpreadElement") &&
        isSameEventValueAccess(argument as EsTreeNode, eventRoot, context),
    );
    const guardsValueAsNumber = test.arguments.some((argument) => {
      const guardedValue = isNodeOfType(argument, "SpreadElement")
        ? null
        : stripParenExpression(argument as EsTreeNode);
      return (
        guardedValue !== null &&
        isNodeOfType(guardedValue, "MemberExpression") &&
        getStaticPropertyName(guardedValue) === "valueAsNumber"
      );
    });
    return Boolean(
      guardedEventValue &&
      (nanGuardProvesNonEmpty || guardsValueAsNumber) &&
      guardName &&
      branchWhenTruthy === (guardName !== "isNaN"),
    );
  }
  if (!isNodeOfType(test, "BinaryExpression")) return false;
  if (!["===", "!==", "==", "!="].includes(test.operator)) return false;
  const left = stripParenExpression(test.left);
  const right = stripParenExpression(test.right);
  const hasEventValueAndEmptyLiteral =
    (isSameEventValueAccess(left, eventRoot, context) &&
      isNodeOfType(right, "Literal") &&
      right.value === "") ||
    (isSameEventValueAccess(right, eventRoot, context) &&
      isNodeOfType(left, "Literal") &&
      left.value === "");
  if (!hasEventValueAndEmptyLiteral) return false;
  const isEquality = test.operator === "===" || test.operator === "==";
  const branchProvesEmpty = branchWhenTruthy === isEquality;
  return branchProvesEmpty !== expectedNonEmpty;
};

const isGuardedByRelatedAncestor = (
  call: EsTreeNode,
  eventRoot: EsTreeNodeOfType<"Identifier">,
  nanGuardProvesNonEmpty: boolean,
  context: RuleContext,
): boolean => {
  let child = call;
  let ancestor = call.parent;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (isNodeOfType(ancestor, "ConditionalExpression") && ancestor.test !== child) {
      const branchWhenTruthy = ancestor.consequent === child;
      if (
        (branchWhenTruthy || ancestor.alternate === child) &&
        branchProvesEventValueState(
          ancestor.test,
          eventRoot,
          branchWhenTruthy,
          true,
          nanGuardProvesNonEmpty,
          context,
        )
      ) {
        return true;
      }
    }
    if (isNodeOfType(ancestor, "LogicalExpression")) {
      if (ancestor.left === child && ancestor.operator === "||") {
        return true;
      }
      if (
        ancestor.right === child &&
        ancestor.operator !== "??" &&
        branchProvesEventValueState(
          ancestor.left,
          eventRoot,
          ancestor.operator === "&&",
          true,
          nanGuardProvesNonEmpty,
          context,
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

// Recognizes guards the ancestor walk cannot see: a preceding early-return
// (`if (e.target.value === "") return;`), a short-circuit whose left operand
// checks the value, and the guard-on-next-line the rule's own recommendation
// produces (`const next = Number(e.target.value); if (!Number.isNaN(next))
// setX(next);`). A guard counts only when its test actually reads the event
// value or the variable holding the parse result.
const blockHasPriorEmptyExitGuard = (
  block: EsTreeNodeOfType<"BlockStatement">,
  call: EsTreeNode,
  eventRoot: EsTreeNodeOfType<"Identifier">,
  nanGuardProvesNonEmpty: boolean,
  context: RuleContext,
  emptyExitGuardOffsetsByBlock: WeakMap<EsTreeNode, Map<boolean, number[]>>,
): boolean => {
  let guardEndOffsetsByNanBehavior = emptyExitGuardOffsetsByBlock.get(block);
  let guardEndOffsets = guardEndOffsetsByNanBehavior?.get(nanGuardProvesNonEmpty);
  if (!guardEndOffsets) {
    guardEndOffsets = block.body.flatMap((statement) => {
      if (
        !isNodeOfType(statement, "IfStatement") ||
        !directlyExits(statement.consequent) ||
        !branchProvesEventValueState(
          statement.test,
          eventRoot,
          true,
          false,
          nanGuardProvesNonEmpty,
          context,
        )
      ) {
        return [];
      }
      return [statement.range[1]];
    });
    guardEndOffsetsByNanBehavior ??= new Map();
    guardEndOffsetsByNanBehavior.set(nanGuardProvesNonEmpty, guardEndOffsets);
    emptyExitGuardOffsetsByBlock.set(block, guardEndOffsetsByNanBehavior);
  }
  let lowerIndex = 0;
  let upperIndex = guardEndOffsets.length;
  while (lowerIndex < upperIndex) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (guardEndOffsets[middleIndex]! <= call.range[0]) lowerIndex = middleIndex + 1;
    else upperIndex = middleIndex;
  }
  return lowerIndex > 0;
};

const handlerGuardsParsedValue = (
  call: EsTreeNode,
  eventRoot: EsTreeNodeOfType<"Identifier">,
  parseResultBinding: EsTreeNode | null,
  nanGuardProvesNonEmpty: boolean,
  handlerAnalysis: NumericHandlerAnalysis,
  context: RuleContext,
  emptyExitGuardOffsetsByBlock: WeakMap<EsTreeNode, Map<boolean, number[]>>,
  guardProtectionByBinding: WeakMap<EsTreeNode, boolean>,
): boolean => {
  let ancestor = call.parent;
  while (ancestor && !isFunctionLike(ancestor)) {
    if (
      isNodeOfType(ancestor, "BlockStatement") &&
      blockHasPriorEmptyExitGuard(
        ancestor,
        call,
        eventRoot,
        nanGuardProvesNonEmpty,
        context,
        emptyExitGuardOffsetsByBlock,
      )
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  if (!nanGuardProvesNonEmpty) return false;
  if (!parseResultBinding) return false;
  const cachedProtection = guardProtectionByBinding.get(parseResultBinding);
  if (cachedProtection !== undefined) return cachedProtection;
  const symbol = context.scopes.symbolFor(parseResultBinding);
  const nanGuardCalls = symbol
    ? (handlerAnalysis.nanGuardCallsBySymbolId.get(symbol.id) ?? [])
    : [];
  const isProtected = nanGuardCalls.some(
    (guardCall) =>
      guardCall.range[0] > call.range[1] &&
      guardCallReferencesBinding(guardCall, parseResultBinding, context) &&
      guardProtectsEveryUse(guardCall, parseResultBinding, context),
  );
  guardProtectionByBinding.set(parseResultBinding, isProtected);
  return isProtected;
};

const analyzeNumericHandler = (
  handler: EsTreeNode,
  context: RuleContext,
): NumericHandlerAnalysis => {
  const nanGuardCallsBySymbolId = new Map<number, EsTreeNodeOfType<"CallExpression">[]>();
  walkAst(handler, (candidate: EsTreeNode) => {
    if (candidate !== handler && isFunctionLike(candidate)) return false;
    if (!isNanGuardCall(candidate, context)) return;
    const referencedSymbolIds = new Set<number>();
    for (const argument of candidate.arguments) {
      walkAst(argument as EsTreeNode, (argumentNode: EsTreeNode) => {
        if (!isNodeOfType(argumentNode, "Identifier")) return;
        const symbol = context.scopes.symbolFor(argumentNode);
        if (symbol) referencedSymbolIds.add(symbol.id);
      });
    }
    for (const symbolId of referencedSymbolIds) {
      const calls = nanGuardCallsBySymbolId.get(symbolId) ?? [];
      calls.push(candidate);
      nanGuardCallsBySymbolId.set(symbolId, calls);
    }
  });
  return { nanGuardCallsBySymbolId };
};

// Resolves the variable the parse result lands in, walking up through pure
// wrapper calls so `const v = Math.floor(Number(e.target.value))` still binds
// `v` and a later `if (!isNaN(v))` counts as a guard.
const getParseResultBinding = (call: EsTreeNode): EsTreeNode | null => {
  let wrappedExpression: EsTreeNode = call;
  let ancestor = call.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "VariableDeclarator")) {
      return isNodeOfType(ancestor.id, "Identifier") ? ancestor.id : null;
    }
    if (stripParenExpression(ancestor) === wrappedExpression) {
      wrappedExpression = ancestor;
      ancestor = ancestor.parent ?? null;
      continue;
    }
    const isCallArgumentWrapper =
      isNodeOfType(ancestor, "CallExpression") &&
      ancestor.arguments.some((callArgument) => callArgument === wrappedExpression);
    if (!isCallArgumentWrapper) return null;
    wrappedExpression = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const getStaticInputType = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): string | null => {
  const typeAttribute = findJsxAttribute(openingElement.attributes ?? [], "type");
  if (!typeAttribute) return null;
  const literalValue = getJsxPropStringValue(typeAttribute);
  if (literalValue !== null) return literalValue;
  const attributeValue = typeAttribute.value;
  if (!attributeValue || !isNodeOfType(attributeValue, "JSXExpressionContainer")) return null;
  let expression: EsTreeNode = attributeValue.expression;
  // `type={AMOUNT_INPUT_TYPE}` — resolve a const binding one hop so a
  // named literal type is as good as an inline one.
  if (isNodeOfType(expression, "Identifier")) {
    const binding = findVariableInitializer(expression, expression.name);
    if (!binding?.initializer) return null;
    expression = stripParenExpression(binding.initializer);
  }
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return expression.value;
  }
  if (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? null;
  }
  return null;
};

const getFirstParameter = (handler: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  const params = (handler as EsTreeNodeOfType<"ArrowFunctionExpression">).params ?? [];
  const first = params[0];
  return first && isNodeOfType(first, "Identifier") ? first : null;
};

// True only when the inline handler is bound to an intrinsic `<input>` whose
// value can still coerce to zero or NaN. Range inputs and radio/checkbox
// inputs with a fixed numeric value are safe by construction.
const isTextualInputElementHandler = (handler: EsTreeNode): boolean => {
  const container = handler.parent;
  if (!container || !isNodeOfType(container, "JSXExpressionContainer")) return false;
  const attribute = container.parent;
  if (!attribute || !isNodeOfType(attribute, "JSXAttribute")) return false;
  if (
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    !HANDLER_ATTRIBUTE_PATTERN.test(attribute.name.name)
  ) {
    return false;
  }
  const openingElement = attribute.parent;
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  if (!isNodeOfType(openingElement.name, "JSXIdentifier") || openingElement.name.name !== "input") {
    return false;
  }
  const staticInputType = getStaticInputType(openingElement);
  if (staticInputType === "range") return false;
  if (!staticInputType || !FIXED_VALUE_INPUT_TYPES.has(staticInputType)) return true;
  const valueAttribute = findJsxAttribute(openingElement.attributes ?? [], "value");
  if (!valueAttribute) return true;
  const staticValue = getJsxPropStringValue(valueAttribute);
  return staticValue === null || staticValue.trim() === "" || !Number.isFinite(Number(staticValue));
};

export const noUnguardedNumericInputParse = defineRule({
  id: "no-unguarded-numeric-input-parse",
  title: "Unguarded numeric parse of an input value",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Guard `Number(e.target.value)` / `parseInt(e.target.value)` against empty and NaN before storing it. `Number('')` is `0` and `Number('abc')` is `NaN`, both of which silently ship a wrong value.",
  create: (context: RuleContext) => {
    const handlerAnalysisByHandler = new WeakMap<EsTreeNode, NumericHandlerAnalysis>();
    const emptyExitGuardOffsetsByBlock = new WeakMap<EsTreeNode, Map<boolean, number[]>>();
    const guardProtectionByBinding = new WeakMap<EsTreeNode, boolean>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNumericParseCallee(node.callee as EsTreeNode, context)) return;
        const argumentList = (node.arguments ?? []) as EsTreeNode[];
        const firstArgument = argumentList[0];
        if (!firstArgument) return;
        const eventRoot = getEventValueRoot(firstArgument);
        if (!eventRoot) return;
        const nanGuardProvesNonEmpty = nanGuardCoversEmptyInput(node, firstArgument, context);

        const handler = findEnclosingHandler(node as EsTreeNode);
        if (!handler) return;
        const firstParameter = getFirstParameter(handler);
        if (!firstParameter || !isSameBinding(firstParameter, eventRoot, context)) return;
        if (
          isGuardedByRelatedAncestor(node as EsTreeNode, eventRoot, nanGuardProvesNonEmpty, context)
        )
          return;
        if (!isTextualInputElementHandler(handler)) return;
        let handlerAnalysis = handlerAnalysisByHandler.get(handler);
        if (!handlerAnalysis) {
          handlerAnalysis = analyzeNumericHandler(handler, context);
          handlerAnalysisByHandler.set(handler, handlerAnalysis);
        }
        const parseResultBinding = getParseResultBinding(node as EsTreeNode);
        if (
          handlerGuardsParsedValue(
            node as EsTreeNode,
            eventRoot,
            parseResultBinding,
            nanGuardProvesNonEmpty,
            handlerAnalysis,
            context,
            emptyExitGuardOffsetsByBlock,
            guardProtectionByBinding,
          )
        ) {
          return;
        }

        context.report({ node, message: MESSAGE });
      },
    };
  },
});
