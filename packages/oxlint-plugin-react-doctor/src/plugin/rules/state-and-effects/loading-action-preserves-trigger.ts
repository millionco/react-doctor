import { PRESENTATION_ROLES, VALID_ARIA_ROLES } from "../../constants/aria-roles.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { isNonInteractiveRole } from "../../utils/is-non-interactive-role.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { nodesCanCoExecute } from "../../utils/nodes-can-co-execute.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const ACTION_INPUT_TYPES = new Set(["button", "image", "submit"]);
const FOCUS_TRANSFER_METHOD_NAMES = new Set(["blur", "focus"]);
const NON_SUBMITTING_BUTTON_TYPES = new Set(["button", "reset"]);
const NAVIGATION_FUNCTION_NAMES = new Set(["navigate", "redirect"]);
const NAVIGATION_METHOD_NAMES = new Set([
  "assign",
  "back",
  "forward",
  "go",
  "open",
  "push",
  "reload",
  "replace",
  "requestSubmit",
  "submit",
  "navigate",
]);
const PASSIVE_INTRINSIC_TAG_NAMES = new Set([
  "article",
  "aside",
  "b",
  "blockquote",
  "code",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "i",
  "li",
  "main",
  "mark",
  "ol",
  "output",
  "p",
  "pre",
  "progress",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "time",
  "u",
  "ul",
]);
const PASSIVITY_UNKNOWN_ATTRIBUTE_NAMES = new Set([
  "accesskey",
  "children",
  "dangerouslysetinnerhtml",
  "draggable",
  "htmlfor",
  "ref",
]);

interface PendingStateProof {
  idleBranch: EsTreeNode;
  pendingBranch: EsTreeNode;
  setterBinding: EsTreeNode;
}

const getStaticJsxAttributeString = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): string | null => {
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
  if (!attribute?.value) return null;
  if (isNodeOfType(attribute.value, "Literal") && typeof attribute.value.value === "string") {
    return attribute.value.value;
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  const expression = stripParenExpression(attribute.value.expression);
  return isNodeOfType(expression, "Literal") && typeof expression.value === "string"
    ? expression.value
    : null;
};

const isDirectlyRenderedConditional = (conditional: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(conditional);
  const parent = expressionRoot.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "ReturnStatement") && parent.argument === expressionRoot) return true;
  if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === expressionRoot)
    return true;
  return (
    isNodeOfType(parent, "JSXExpressionContainer") &&
    parent.expression === expressionRoot &&
    Boolean(
      parent.parent &&
      (isNodeOfType(parent.parent, "JSXElement") || isNodeOfType(parent.parent, "JSXFragment")),
    )
  );
};

const resolvePendingStateProof = (
  conditional: EsTreeNodeOfType<"ConditionalExpression">,
  context: RuleContext,
): PendingStateProof | null => {
  const test = stripParenExpression(conditional.test);
  const isNegated = isNodeOfType(test, "UnaryExpression") && test.operator === "!";
  const stateReference = isNegated ? stripParenExpression(test.argument) : test;
  if (!isNodeOfType(stateReference, "Identifier")) return null;
  const stateSymbol = context.scopes.symbolFor(stateReference);
  if (
    !stateSymbol ||
    stateSymbol.kind !== "const" ||
    stateSymbol.references.length !== 1 ||
    stateSymbol.references[0]?.identifier !== stateReference ||
    !isNodeOfType(stateSymbol.declarationNode, "VariableDeclarator")
  ) {
    return null;
  }
  const declarator = stateSymbol.declarationNode;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return null;
  const stateBinding = declarator.id.elements[0];
  const setterBinding = declarator.id.elements[1];
  if (
    stateBinding !== stateSymbol.bindingIdentifier ||
    !isNodeOfType(stateBinding, "Identifier") ||
    !isNodeOfType(setterBinding, "Identifier") ||
    declarator.id.elements.length !== 2 ||
    !declarator.init
  ) {
    return null;
  }
  const initializer = stripParenExpression(declarator.init);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    !isReactApiCall(initializer, "useState", context.scopes, { resolveNamedAliases: true }) ||
    initializer.arguments.length !== 1
  ) {
    return null;
  }
  const initialState = stripParenExpression(initializer.arguments[0]);
  if (!isNodeOfType(initialState, "Literal") || initialState.value !== false) return null;
  if (findEnclosingFunction(stateBinding) !== findEnclosingFunction(conditional)) return null;
  return {
    idleBranch: isNegated ? conditional.consequent : conditional.alternate,
    pendingBranch: isNegated ? conditional.alternate : conditional.consequent,
    setterBinding,
  };
};

const getActionOpeningElement = (
  branch: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  const branchExpression = stripParenExpression(branch);
  if (!isNodeOfType(branchExpression, "JSXElement")) return null;
  const openingElement = branchExpression.openingElement;
  if (
    !isProvenIntrinsicJsxElement(openingElement, context.scopes) ||
    hasJsxSpreadAttribute(openingElement.attributes)
  ) {
    return null;
  }
  const tagName = resolveJsxElementType(openingElement).toLowerCase();
  if (tagName === "button") return openingElement;
  if (tagName !== "input") return null;
  const inputType = getStaticJsxAttributeString(openingElement, "type")?.toLowerCase();
  return inputType && ACTION_INPUT_TYPES.has(inputType) ? openingElement : null;
};

const jsxAttributeHasStaticNullValue = (attribute: EsTreeNode): boolean => {
  if (!isNodeOfType(attribute, "JSXAttribute") || !attribute.value) return false;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const expression = stripParenExpression(attribute.value.expression);
  return isNodeOfType(expression, "Literal") && expression.value === null;
};

const resolveStaticRole = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): string | null | undefined => {
  const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role", false);
  if (!roleAttribute) return null;
  const role = getStaticJsxAttributeString(openingElement, "role");
  if (role === null) return undefined;
  const firstValidRole = role
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .find((roleToken) => VALID_ARIA_ROLES.has(roleToken));
  return firstValidRole ?? undefined;
};

const proveBranchIsPassive = (branch: EsTreeNode, context: RuleContext): boolean | null => {
  const expression = stripParenExpression(branch);
  if (isNodeOfType(expression, "Literal")) {
    return expression.value === null ||
      expression.value === false ||
      expression.value === true ||
      typeof expression.value === "string" ||
      typeof expression.value === "number"
      ? true
      : null;
  }
  if (isNodeOfType(expression, "JSXText") || isNodeOfType(expression, "JSXEmptyExpression")) {
    return true;
  }
  if (isNodeOfType(expression, "JSXExpressionContainer")) {
    return proveBranchIsPassive(expression.expression, context);
  }
  if (isNodeOfType(expression, "JSXFragment")) {
    for (const child of expression.children) {
      const childProof = proveBranchIsPassive(child, context);
      if (childProof !== true) return childProof;
    }
    return true;
  }
  if (!isNodeOfType(expression, "JSXElement")) return null;
  const openingElement = expression.openingElement;
  if (
    !isProvenIntrinsicJsxElement(openingElement, context.scopes) ||
    hasJsxSpreadAttribute(openingElement.attributes)
  ) {
    return null;
  }
  const tagName = resolveJsxElementType(openingElement).toLowerCase();
  if (isInteractiveElement(tagName, openingElement)) return false;
  if (!PASSIVE_INTRINSIC_TAG_NAMES.has(tagName)) return null;
  const staticRole = resolveStaticRole(openingElement);
  if (staticRole === undefined) return null;
  if (staticRole && isInteractiveRole(staticRole)) return false;
  if (staticRole && !isNonInteractiveRole(staticRole) && !PRESENTATION_ROLES.has(staticRole)) {
    return null;
  }
  for (const attribute of openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const attributeName = getJsxAttributeName(attribute.name);
    if (!attributeName) return null;
    const normalizedAttributeName = attributeName.toLowerCase();
    if (PASSIVITY_UNKNOWN_ATTRIBUTE_NAMES.has(normalizedAttributeName)) return null;
    if (/^on[A-Z]/.test(attributeName) && !jsxAttributeHasStaticNullValue(attribute)) return false;
    if (
      normalizedAttributeName === "tabindex" ||
      normalizedAttributeName === "contenteditable" ||
      normalizedAttributeName === "autofocus"
    ) {
      return false;
    }
  }
  for (const child of expression.children) {
    const childProof = proveBranchIsPassive(child, context);
    if (childProof !== true) return childProof;
  }
  return true;
};

const getBranchRootIdentity = (branch: EsTreeNode, context: RuleContext): string | null => {
  const expression = stripParenExpression(branch);
  if (
    isNodeOfType(expression, "Literal") &&
    (expression.value === null || expression.value === false)
  ) {
    return null;
  }
  if (isNodeOfType(expression, "JSXFragment")) return "#fragment";
  if (!isNodeOfType(expression, "JSXElement")) return null;
  const openingElement = expression.openingElement;
  return isProvenIntrinsicJsxElement(openingElement, context.scopes)
    ? resolveJsxElementType(openingElement).toLowerCase()
    : null;
};

const getJsxAttributeExpression = (attribute: EsTreeNode): EsTreeNode | null => {
  if (
    !isNodeOfType(attribute, "JSXAttribute") ||
    !attribute.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer")
  ) {
    return null;
  }
  return stripParenExpression(attribute.value.expression);
};

const readStaticDisabledState = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: "aria-disabled" | "disabled",
): boolean | null => {
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
  if (!attribute) return false;
  if (!attribute.value) return true;
  const value = isNodeOfType(attribute.value, "JSXExpressionContainer")
    ? stripParenExpression(attribute.value.expression)
    : attribute.value;
  if (!isNodeOfType(value, "Literal")) return null;
  if (value.value === null || value.value === false) return false;
  if (value.value === true) return true;
  if (attributeName === "disabled")
    return typeof value.value === "string" ? true : Boolean(value.value);
  if (typeof value.value !== "string") return null;
  const normalizedValue = value.value.toLowerCase();
  if (normalizedValue === "false") return false;
  if (normalizedValue === "true") return true;
  return null;
};

const hasPossibleAncestorFormOwner = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  let ancestor = openingElement.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const ancestorOpeningElement = ancestor.openingElement;
      if (!isProvenIntrinsicJsxElement(ancestorOpeningElement, context.scopes)) return true;
      if (resolveJsxElementType(ancestorOpeningElement).toLowerCase() === "form") return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const actionMaySubmitEnclosingForm = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const tagName = resolveJsxElementType(openingElement).toLowerCase();
  const actionType = getStaticJsxAttributeString(openingElement, "type")?.toLowerCase();
  const hasFormOwnerAttribute = Boolean(
    getAuthoritativeJsxAttribute(openingElement.attributes, "form", false),
  );
  const isSubmitCapable =
    tagName === "button"
      ? !NON_SUBMITTING_BUTTON_TYPES.has(actionType ?? "")
      : tagName === "input" && (actionType === "image" || actionType === "submit");
  if (!isSubmitCapable) return false;
  return hasFormOwnerAttribute || hasPossibleAncestorFormOwner(openingElement, context);
};

const resolveActionHandler = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): EsTreeNode | null => {
  if (readStaticDisabledState(openingElement, "disabled") !== false) return null;
  if (readStaticDisabledState(openingElement, "aria-disabled") !== false) return null;
  if (actionMaySubmitEnclosingForm(openingElement, context)) return null;
  const handlerAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "onClick");
  if (!handlerAttribute) return null;
  const handlerExpression = getJsxAttributeExpression(handlerAttribute);
  if (!handlerExpression) return null;
  if (isFunctionLike(handlerExpression)) return handlerExpression;
  if (!isNodeOfType(handlerExpression, "Identifier")) return null;
  const handlerSymbol = context.scopes.symbolFor(handlerExpression);
  if (
    !handlerSymbol ||
    handlerSymbol.references.length !== 1 ||
    handlerSymbol.references[0]?.identifier !== handlerExpression
  ) {
    return null;
  }
  return resolveExactLocalFunction(handlerExpression, context.scopes);
};

const callTransfersFocusOrNavigates = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return NAVIGATION_FUNCTION_NAMES.has(callee.name) || /^setFocus$/i.test(callee.name);
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  return Boolean(
    methodName &&
    (FOCUS_TRANSFER_METHOD_NAMES.has(methodName) || NAVIGATION_METHOD_NAMES.has(methodName)),
  );
};

const handlerTransfersFocusOrNavigates = (handler: EsTreeNode): boolean => {
  let transfers = false;
  walkAst(handler, (node: EsTreeNode) => {
    if (node !== handler && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "CallExpression") && callTransfersFocusOrNavigates(node)) {
      transfers = true;
      return false;
    }
    if (isNodeOfType(node, "AssignmentExpression")) {
      const assignmentTarget = stripParenExpression(node.left);
      if (isNodeOfType(assignmentTarget, "MemberExpression")) {
        const propertyName = getStaticPropertyName(assignmentTarget);
        if (propertyName === "href" || propertyName === "location") {
          transfers = true;
          return false;
        }
      }
    }
  });
  return transfers;
};

const isProvenFetchSuspension = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "AwaitExpression")) return false;
  const argument = stripParenExpression(node.argument);
  return (
    isNodeOfType(argument, "CallExpression") &&
    isNodeOfType(argument.callee, "Identifier") &&
    argument.callee.name === "fetch" &&
    context.scopes.isGlobalReference(argument.callee)
  );
};

const handlerStartsPendingBeforeFetch = (
  handler: EsTreeNode,
  setterBinding: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(handler) || !handler.async) return false;
  const setterSymbol = context.scopes.symbolFor(setterBinding);
  if (!setterSymbol || setterSymbol.references.length === 0) return false;
  const setterCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  for (const reference of setterSymbol.references) {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const callExpression = referenceRoot.parent;
    if (
      reference.flag !== "read" ||
      !callExpression ||
      !isNodeOfType(callExpression, "CallExpression") ||
      callExpression.callee !== referenceRoot ||
      findEnclosingFunction(callExpression) !== handler ||
      callExpression.arguments.length !== 1
    ) {
      return false;
    }
    const setterValue = stripParenExpression(callExpression.arguments[0]);
    if (!isNodeOfType(setterValue, "Literal") || typeof setterValue.value !== "boolean") {
      return false;
    }
    setterCalls.push(callExpression);
  }
  const truthyCalls = setterCalls.filter((callExpression) => {
    const argument = stripParenExpression(callExpression.arguments[0]);
    return isNodeOfType(argument, "Literal") && argument.value === true;
  });
  if (truthyCalls.length !== 1) return false;
  const truthyCall = truthyCalls[0];
  if (!truthyCall || !isNodeOfType(truthyCall.parent, "ExpressionStatement")) return false;
  const fetchSuspensions: EsTreeNode[] = [];
  walkAst(handler, (node: EsTreeNode) => {
    if (node !== handler && isFunctionLike(node)) return false;
    if (isProvenFetchSuspension(node, context) && isNodeReachableWithinFunction(node, context)) {
      fetchSuspensions.push(node);
    }
  });
  const functionCfg = context.cfg.cfgFor(handler);
  const truthyBlock = functionCfg?.blockOf(truthyCall);
  const truthyStart = getRangeStart(truthyCall);
  if (!functionCfg || !truthyBlock || truthyStart === null) return false;
  return fetchSuspensions.some((suspension) => {
    const suspensionStart = getRangeStart(suspension);
    if (
      suspensionStart === null ||
      truthyStart >= suspensionStart ||
      functionCfg.blockOf(suspension) !== truthyBlock
    ) {
      return false;
    }
    const precedingSetterCalls = setterCalls
      .filter((setterCall) => {
        const setterStart = getRangeStart(setterCall);
        return (
          setterStart !== null &&
          setterStart < suspensionStart &&
          nodesCanCoExecute(setterCall, suspension, context)
        );
      })
      .sort((left, right) => (getRangeStart(left) ?? 0) - (getRangeStart(right) ?? 0));
    return precedingSetterCalls.at(-1) === truthyCall;
  });
};

export const loadingActionPreservesTrigger = defineRule({
  id: "loading-action-preserves-trigger",
  title: "Loading state removes its initiating action",
  tags: ["react-jsx-only"],
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Keep the initiating control mounted while work is pending. Disable it or mark it busy, and put the spinner or status inside the same control so focus and action identity remain stable.",
  create: (context: RuleContext): RuleVisitors => ({
    ConditionalExpression(conditional: EsTreeNodeOfType<"ConditionalExpression">) {
      if (!isDirectlyRenderedConditional(conditional)) return;
      const stateProof = resolvePendingStateProof(conditional, context);
      if (!stateProof) return;
      const actionOpeningElement = getActionOpeningElement(stateProof.idleBranch, context);
      if (!actionOpeningElement) return;
      if (proveBranchIsPassive(stateProof.pendingBranch, context) !== true) return;
      const actionRootIdentity = resolveJsxElementType(actionOpeningElement).toLowerCase();
      if (getBranchRootIdentity(stateProof.pendingBranch, context) === actionRootIdentity) return;
      const handler = resolveActionHandler(actionOpeningElement, context);
      if (!handler || handlerTransfersFocusOrNavigates(handler)) return;
      if (!handlerStartsPendingBeforeFetch(handler, stateProof.setterBinding, context)) return;
      context.report({
        node: conditional,
        message:
          "This pending branch replaces the control that started the request with passive content, so the control and its focus disappear while the request is in flight. Keep the control mounted and render its busy state inside it.",
      });
    },
  }),
});
