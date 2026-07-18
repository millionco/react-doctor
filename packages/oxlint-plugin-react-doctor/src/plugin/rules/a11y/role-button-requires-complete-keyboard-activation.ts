import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const ENTER_KEY = "enter";
const SPACE_KEY = "space";
const KEYBOARD_HANDLER_NAMES = ["onKeyDown", "onKeyUp", "onKeyPress"];
const NON_ACTIVATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "debug",
  "error",
  "info",
  "log",
  "preventDefault",
  "stopImmediatePropagation",
  "stopPropagation",
  "trace",
  "warn",
]);

const getHandlerExpression = (attribute: EsTreeNodeOfType<"JSXAttribute">): EsTreeNode | null => {
  if (
    !attribute.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    !attribute.value.expression
  ) {
    return null;
  }
  return attribute.value.expression;
};

const getKeyboardEventProperty = (
  expression: EsTreeNode,
  eventSymbolId: number,
  context: RuleContext,
): string | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(unwrappedExpression);
  if (propertyName !== "key" && propertyName !== "code") return null;
  const eventObject = stripParenExpression(unwrappedExpression.object);
  if (!isNodeOfType(eventObject, "Identifier")) return null;
  const reference = context.scopes.referenceFor(eventObject);
  return reference?.resolvedSymbol?.id === eventSymbolId ? propertyName : null;
};

const getActivationKeyFromLiteral = (
  propertyName: string,
  expression: EsTreeNode,
): string | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    !isNodeOfType(unwrappedExpression, "Literal") ||
    typeof unwrappedExpression.value !== "string"
  ) {
    return null;
  }
  if (unwrappedExpression.value === "Enter") return ENTER_KEY;
  if (propertyName === "code" && unwrappedExpression.value === "NumpadEnter") return ENTER_KEY;
  if (
    (propertyName === "key" &&
      (unwrappedExpression.value === " " || unwrappedExpression.value === "Spacebar")) ||
    (propertyName === "code" && unwrappedExpression.value === "Space")
  ) {
    return SPACE_KEY;
  }
  return null;
};

const getComparedActivationKey = (
  node: EsTreeNodeOfType<"BinaryExpression">,
  eventSymbolId: number,
  context: RuleContext,
): string | null => {
  if (node.operator !== "==" && node.operator !== "===") return null;
  const leftProperty = getKeyboardEventProperty(node.left, eventSymbolId, context);
  if (leftProperty) return getActivationKeyFromLiteral(leftProperty, node.right);
  const rightProperty = getKeyboardEventProperty(node.right, eventSymbolId, context);
  return rightProperty ? getActivationKeyFromLiteral(rightProperty, node.left) : null;
};

const callDelegatesKeyboardEvent = (
  call: EsTreeNodeOfType<"CallExpression">,
  eventSymbolId: number,
  context: RuleContext,
): boolean =>
  call.arguments.some((argument) => {
    if (isNodeOfType(argument, "SpreadElement")) return false;
    const unwrappedArgument = stripParenExpression(argument);
    if (isNodeOfType(unwrappedArgument, "Identifier")) {
      return context.scopes.referenceFor(unwrappedArgument)?.resolvedSymbol?.id === eventSymbolId;
    }
    return getKeyboardEventProperty(unwrappedArgument, eventSymbolId, context) !== null;
  });

const getDirectCallCallee = (handlerExpression: EsTreeNode): EsTreeNode | null => {
  const unwrappedExpression = stripParenExpression(handlerExpression);
  if (
    isNodeOfType(unwrappedExpression, "Identifier") ||
    isNodeOfType(unwrappedExpression, "MemberExpression")
  ) {
    return unwrappedExpression;
  }
  if (!isFunctionLike(unwrappedExpression)) return null;
  const body = stripParenExpression(unwrappedExpression.body);
  if (isNodeOfType(body, "CallExpression")) return body.callee;
  if (!isNodeOfType(body, "BlockStatement") || body.body.length !== 1) return null;
  const statement = body.body[0];
  let actionExpression: EsTreeNode | null = null;
  if (isNodeOfType(statement, "ExpressionStatement")) {
    actionExpression = statement.expression;
  } else if (isNodeOfType(statement, "ReturnStatement")) {
    actionExpression = statement.argument;
  }
  const unwrappedAction = actionExpression ? stripParenExpression(actionExpression) : null;
  return unwrappedAction && isNodeOfType(unwrappedAction, "CallExpression")
    ? unwrappedAction.callee
    : null;
};

const callMatchesClickAction = (
  call: EsTreeNodeOfType<"CallExpression">,
  expectedClickCalleeKey: string,
  context: RuleContext,
): boolean => resolveExpressionKey(call.callee, context) === expectedClickCalleeKey;

const isPlausibleActivationCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  expectedClickCalleeKey: string,
  context: RuleContext,
): boolean => {
  const methodName = isNodeOfType(call.callee, "MemberExpression")
    ? getStaticPropertyName(call.callee)
    : null;
  if (methodName && NON_ACTIVATION_METHOD_NAMES.has(methodName)) return false;
  return callMatchesClickAction(call, expectedClickCalleeKey, context);
};

const containsPlausibleActivationCall = (
  root: EsTreeNode | null | undefined,
  expectedClickCalleeKey: string,
  context: RuleContext,
): boolean => {
  if (!root) return false;
  let didFindActivation = false;
  walkAst(root, (child) => {
    if (didFindActivation) return false;
    if (child !== root && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isPlausibleActivationCall(child, expectedClickCalleeKey, context)
    ) {
      didFindActivation = true;
      return false;
    }
  });
  return didFindActivation;
};

const equalityControlsActivation = (
  comparison: EsTreeNodeOfType<"BinaryExpression">,
  expectedClickCalleeKey: string,
  context: RuleContext,
): boolean => {
  let current = findTransparentExpressionRoot(comparison);
  while (current.parent) {
    const parent = current.parent;
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") return false;
    if (isNodeOfType(parent, "LogicalExpression")) {
      if (
        parent.operator === "&&" &&
        parent.left === current &&
        containsPlausibleActivationCall(parent.right, expectedClickCalleeKey, context)
      ) {
        return true;
      }
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    if (isNodeOfType(parent, "IfStatement") && parent.test === current) {
      return containsPlausibleActivationCall(parent.consequent, expectedClickCalleeKey, context);
    }
    if (isNodeOfType(parent, "ConditionalExpression") && parent.test === current) {
      return containsPlausibleActivationCall(parent.consequent, expectedClickCalleeKey, context);
    }
    return false;
  }
  return false;
};

const switchCasePathContainsActivation = (
  switchCases: ReadonlyArray<EsTreeNode>,
  startIndex: number,
  expectedClickCalleeKey: string,
  context: RuleContext,
): boolean => {
  for (let caseIndex = startIndex; caseIndex < switchCases.length; caseIndex += 1) {
    const switchCase = switchCases[caseIndex];
    if (!isNodeOfType(switchCase, "SwitchCase")) return false;
    for (const statement of switchCase.consequent) {
      if (containsPlausibleActivationCall(statement, expectedClickCalleeKey, context)) return true;
      if (
        isNodeOfType(statement, "BreakStatement") ||
        isNodeOfType(statement, "ContinueStatement") ||
        isNodeOfType(statement, "ReturnStatement") ||
        isNodeOfType(statement, "ThrowStatement")
      ) {
        return false;
      }
    }
  }
  return false;
};

const collectRecognizedActivationKeys = (
  handler: EsTreeNode,
  expectedClickCalleeKey: string,
  context: RuleContext,
): Set<string> | null => {
  if (!isFunctionLike(handler)) return null;
  const eventParameter = handler.params[0];
  if (!eventParameter || !isNodeOfType(eventParameter, "Identifier")) return null;
  const eventSymbol = context.scopes.symbolFor(eventParameter);
  if (!eventSymbol) return null;

  const activationKeys = new Set<string>();
  let hasOpaqueEventDelegation = false;
  walkAst(handler.body, (child) => {
    if (child !== handler.body && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "BinaryExpression")) {
      const activationKey = getComparedActivationKey(child, eventSymbol.id, context);
      if (activationKey && equalityControlsActivation(child, expectedClickCalleeKey, context)) {
        activationKeys.add(activationKey);
      }
      return;
    }
    if (isNodeOfType(child, "SwitchStatement")) {
      const propertyName = getKeyboardEventProperty(child.discriminant, eventSymbol.id, context);
      if (!propertyName) return;
      for (let caseIndex = 0; caseIndex < child.cases.length; caseIndex += 1) {
        const switchCase = child.cases[caseIndex];
        if (!switchCase.test) continue;
        const activationKey = getActivationKeyFromLiteral(propertyName, switchCase.test);
        if (
          activationKey &&
          switchCasePathContainsActivation(child.cases, caseIndex, expectedClickCalleeKey, context)
        ) {
          activationKeys.add(activationKey);
        }
      }
      return;
    }
    if (
      isNodeOfType(child, "CallExpression") &&
      callDelegatesKeyboardEvent(child, eventSymbol.id, context) &&
      !callMatchesClickAction(child, expectedClickCalleeKey, context)
    ) {
      hasOpaqueEventDelegation = true;
    }
  });
  return hasOpaqueEventDelegation ? null : activationKeys;
};

export const roleButtonRequiresCompleteKeyboardActivation = defineRule({
  id: "role-button-requires-complete-keyboard-activation",
  title: "ARIA button handles only one activation key",
  severity: "warn",
  recommendation:
    "Use a native button, or make a custom role button activate with both Enter and Space.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isNodeOfType(node.name, "JSXIdentifier") ||
        !HTML_TAGS.has(node.name.name) ||
        node.name.name === "button" ||
        hasJsxSpreadAttribute(node.attributes)
      ) {
        return;
      }
      const roleAttribute = getAuthoritativeJsxAttribute(node.attributes, "role", false);
      if (
        !roleAttribute ||
        getStringLiteralAttributeValue(roleAttribute)?.toLowerCase() !== "button"
      ) {
        return;
      }
      const clickAttribute = getAuthoritativeJsxAttribute(node.attributes, "onClick", false);
      if (!clickAttribute) return;
      const clickHandlerExpression = getHandlerExpression(clickAttribute);
      const directClickCallee = clickHandlerExpression
        ? getDirectCallCallee(clickHandlerExpression)
        : null;
      const expectedClickCalleeKey = directClickCallee
        ? resolveExpressionKey(directClickCallee, context)
        : null;
      if (!expectedClickCalleeKey) return;

      const activationKeys = new Set<string>();
      for (const handlerName of KEYBOARD_HANDLER_NAMES) {
        const keyboardAttribute = getAuthoritativeJsxAttribute(node.attributes, handlerName, false);
        if (!keyboardAttribute) continue;
        const handlerExpression = getHandlerExpression(keyboardAttribute);
        if (!handlerExpression) return;
        const handler = resolveExactLocalFunction(handlerExpression, context.scopes);
        if (!handler) return;
        const handlerActivationKeys = collectRecognizedActivationKeys(
          handler,
          expectedClickCalleeKey,
          context,
        );
        if (!handlerActivationKeys || handlerActivationKeys.size === 0) return;
        for (const activationKey of handlerActivationKeys) activationKeys.add(activationKey);
      }
      if (activationKeys.size !== 1) return;

      const missingKey = activationKeys.has(ENTER_KEY) ? "Space" : "Enter";
      context.report({
        node: roleAttribute,
        message: `This ARIA button handles only one activation key. Add ${missingKey} support or use a native button so keyboard users can activate it consistently.`,
      });
    },
  }),
});
