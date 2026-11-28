import { BOOLEAN_COMPARISON_OPERATORS } from "../../../constants/boolean-comparison-operators.js";
import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { LAYOUT_MEASUREMENT_MEMBER_NAMES } from "../../../utils/reads-post-mount-value.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isIntrinsicElementRefReceiver } from "./is-intrinsic-element-ref-receiver.js";

const RECTANGLE_COORDINATE_NAMES: ReadonlySet<string> = new Set([
  "bottom",
  "height",
  "left",
  "right",
  "top",
  "width",
  "x",
  "y",
]);

const isPlainStateEventHandler = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const handler = stripParenExpression(attribute.value.expression);
  if (!isNodeOfType(handler, "ArrowFunctionExpression") || handler.async || handler.params.length) {
    return false;
  }
  const call = stripParenExpression(handler.body);
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== 1) {
    return false;
  }
  const pair = resolveReactUseStatePair(call.callee, scopes);
  if (
    !pair ||
    !pair.declarator.init ||
    !isReactApiCall(pair.declarator.init, "useState", scopes, { resolveNamedAliases: true }) ||
    findEnclosingFunction(pair.declarator) !== findEnclosingFunction(handler)
  ) {
    return false;
  }
  const argument = stripParenExpression(call.arguments[0]);
  if (isNodeOfType(argument, "Literal")) return true;
  if (!isNodeOfType(argument, "UnaryExpression") || argument.operator !== "!") return false;
  const state = stripParenExpression(argument.argument);
  return (
    isNodeOfType(state, "Identifier") &&
    pair.stateSymbol !== null &&
    scopes.symbolFor(state) === pair.stateSymbol
  );
};

const isUnmodifiedHtmlAttachment = (
  element: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
  allowsNearestRef: boolean,
): boolean =>
  HTML_TAGS.has(resolveJsxElementType(element)) &&
  element.attributes.every((attribute) => {
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const name = getJsxAttributeName(attribute.name);
    return (
      name !== "is" &&
      (name !== "ref" || allowsNearestRef) &&
      (!name?.startsWith("on") || isPlainStateEventHandler(attribute, scopes))
    );
  });

const isUnmodifiedHtmlTree = (
  tree: EsTreeNode,
  scopes: ScopeAnalysis,
  attachment: EsTreeNode | null,
  attachedBranch?: EsTreeNode,
): boolean => {
  let isUnmodified = true;
  walkAst(tree, (child) => {
    if (!isUnmodified || child === attachedBranch) return false;
    if (isNodeOfType(child, "JSXOpeningElement")) {
      isUnmodified = isUnmodifiedHtmlAttachment(child, scopes, child === attachment);
    }
  });
  return isUnmodified;
};

const isElementMeasurementProperty = (propertyName: string | null): boolean =>
  propertyName !== null &&
  propertyName !== "current" &&
  LAYOUT_MEASUREMENT_MEMBER_NAMES.has(propertyName);

const getRectangleCallMember = (
  expression: EsTreeNode,
): EsTreeNodeOfType<"MemberExpression"> | null => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.arguments.length !== 0) return null;
  const callee = stripParenExpression(call.callee);
  return isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyName(callee) === "getBoundingClientRect"
    ? callee
    : null;
};

const isMeasurementMemberUse = (member: EsTreeNodeOfType<"MemberExpression">): boolean => {
  if (isElementMeasurementProperty(getStaticPropertyName(member))) return true;
  const expression = findTransparentExpressionRoot(member);
  const parent = expression.parent;
  return parent != null && getRectangleCallMember(parent) === member;
};

const resolveEffectLocalValue = (
  expression: EsTreeNode,
  effectFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode => {
  let current = stripParenExpression(expression);
  const seen = new Set<number>();
  while (isNodeOfType(current, "Identifier")) {
    const symbol = scopes.symbolFor(current);
    if (!symbol || seen.has(symbol.id)) break;
    const initializer = getDirectConstInitializer(symbol);
    if (
      !initializer ||
      findEnclosingFunction(initializer) !== effectFunction ||
      getNodeStartIndex(initializer) >= getNodeStartIndex(current)
    ) {
      break;
    }
    seen.add(symbol.id);
    current = stripParenExpression(initializer);
  }
  return current;
};

export const isOwnedDomMeasurementValue = (
  expression: EsTreeNode,
  effectFunction: EsTreeNode,
  scopes: ScopeAnalysis,
  receiverCache: WeakMap<SymbolDescriptor, boolean>,
): boolean => {
  const readOwnedMember = (member: EsTreeNodeOfType<"MemberExpression">): boolean | null => {
    const receiver = resolveEffectLocalValue(member.object, effectFunction, scopes);
    if (
      !isNodeOfType(receiver, "MemberExpression") ||
      getStaticPropertyName(receiver) !== "current" ||
      !isIntrinsicElementRefReceiver(receiver, scopes, {
        allowsAttachment: (element) =>
          isUnmodifiedHtmlTree(element.parent ?? element, scopes, element),
        allowsAncestor: (tree, attachedBranch) =>
          isUnmodifiedHtmlTree(tree, scopes, null, attachedBranch),
        allowsElementMember: isMeasurementMemberUse,
        receiverCache,
      })
    ) {
      return null;
    }
    return receiver.computed || member.computed;
  };

  const setterValue = resolveEffectLocalValue(expression, effectFunction, scopes);
  const pending = [setterValue];
  const examinedValues = new WeakSet<EsTreeNode>();
  let hasStaticBracket = false;
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) return false;
    const value = resolveEffectLocalValue(next, effectFunction, scopes);
    if (examinedValues.has(value)) continue;
    examinedValues.add(value);
    if (isNodeOfType(value, "Literal") && !("regex" in value)) continue;
    if (isNodeOfType(value, "UnaryExpression") && value.operator === "!") {
      pending.push(value.argument);
      continue;
    }
    if (
      isNodeOfType(value, "BinaryExpression") &&
      BOOLEAN_COMPARISON_OPERATORS.has(value.operator)
    ) {
      pending.push(value.left, value.right);
      continue;
    }
    if (isNodeOfType(value, "LogicalExpression") && value.operator === "??") {
      const fallback = resolveEffectLocalValue(value.right, effectFunction, scopes);
      if (!isNodeOfType(fallback, "Literal") || "regex" in fallback) return false;
      pending.push(value.left);
      continue;
    }

    let bracket: boolean | null = null;
    if (isNodeOfType(value, "MemberExpression")) {
      const name = getStaticPropertyName(value);
      if (isElementMeasurementProperty(name)) {
        bracket = readOwnedMember(value);
      } else if (name !== null && RECTANGLE_COORDINATE_NAMES.has(name)) {
        const rectangleMember = getRectangleCallMember(
          resolveEffectLocalValue(value.object, effectFunction, scopes),
        );
        if (rectangleMember) {
          const rectangleBracket = readOwnedMember(rectangleMember);
          if (rectangleBracket !== null) bracket = value.computed || rectangleBracket;
        }
      }
    } else if (value === setterValue) {
      const rectangleMember = getRectangleCallMember(value);
      if (rectangleMember) bracket = readOwnedMember(rectangleMember);
    }
    if (bracket === null) return false;
    hasStaticBracket ||= bracket;
  }
  return hasStaticBracket;
};
