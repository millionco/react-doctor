import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { isReactEffectHookCall } from "../../../utils/is-react-effect-hook-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isEffectCallbackReference } from "../../../utils/is-effect-callback-reference.js";
import { hasJsxSpreadAttribute } from "../../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../../utils/is-proven-intrinsic-jsx-element.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isCreateRefResultWriteOnly } from "../is-create-ref-result-write-only.js";
import { isValueRenderedInSameRender } from "../is-value-rendered-in-same-render.js";
import {
  INLINE_MAP_ARGUMENT_COUNT,
  INLINE_MAP_EFFECT_DEPENDENCIES_ARGUMENT_INDEX,
  INLINE_MAP_FIRST_ARGUMENT_INDEX,
  INLINE_MAP_EVENT_ATTRIBUTE_COUNT,
  INLINE_MAP_NATIVE_EVENT_NAMES,
  INLINE_MAP_MINIMUM_ELEMENT_INDEX,
} from "./constants.js";

interface ObservedInlineMapRefResultInput {
  mapCall: EsTreeNodeOfType<"CallExpression">;
  owner: EsTreeNode;
  filename: string;
  scopes: ScopeAnalysis;
}

const observerSymbolsByScope = new WeakMap<
  ScopeDescriptor,
  WeakMap<EsTreeNode, WeakMap<EsTreeNode, SymbolDescriptor>>
>();

export const hasObservedInlineMapRefResult = ({
  mapCall,
  owner,
  filename,
  scopes,
}: ObservedInlineMapRefResultInput): boolean => {
  const resultRoot = findTransparentExpressionRoot(mapCall);
  const result = resultRoot.parent;
  if (
    !isNodeOfType(result, "VariableDeclarator") ||
    result.init !== resultRoot ||
    !isNodeOfType(result.id, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(result.id);
  if (
    symbol?.kind !== "const" ||
    symbol.bindingIdentifier !== result.id ||
    symbol.references.some((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return false;
      if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) return true;
      const root = findTransparentExpressionRoot(reference.identifier);
      const parent = root.parent;
      if (isNodeOfType(parent, "MemberExpression") && parent.object === root) {
        const memberRoot = findTransparentExpressionRoot(parent);
        const consumer = memberRoot.parent;
        return (
          (isNodeOfType(consumer, "CallExpression") || isNodeOfType(consumer, "NewExpression")) &&
          consumer.callee === memberRoot
        );
      }
      if (
        isNodeOfType(parent, "UnaryExpression") &&
        parent.argument === root &&
        (parent.operator === "void" || parent.operator === "typeof" || parent.operator === "!")
      )
        return false;
      const dependencies = isNodeOfType(parent, "ArrayExpression")
        ? findTransparentExpressionRoot(parent)
        : null;
      const effect = dependencies?.parent;
      return !(
        dependencies &&
        isNodeOfType(effect, "CallExpression") &&
        effect.arguments[INLINE_MAP_EFFECT_DEPENDENCIES_ARGUMENT_INDEX] === dependencies &&
        isReactEffectHookCall(effect, scopes)
      );
    }) ||
    isCreateRefResultWriteOnly(mapCall, filename, scopes)
  )
    return false;
  const isNativeEventCallback = (functionNode: EsTreeNode): boolean => {
    if (!isNodeOfType(functionNode, "ArrowFunctionExpression") || functionNode.async) return false;
    const functionRoot = findTransparentExpressionRoot(functionNode);
    const container = functionRoot.parent;
    const attribute = container?.parent;
    const opening = attribute?.parent;
    const eventName =
      isNodeOfType(attribute, "JSXAttribute") && isNodeOfType(attribute.name, "JSXIdentifier")
        ? attribute.name.name
        : null;
    const renderFunction = opening ? findEnclosingFunction(opening) : null;
    const renderRoot = renderFunction ? findTransparentExpressionRoot(renderFunction) : null;
    const renderCall = renderRoot?.parent;
    const renderReceiver =
      isNodeOfType(renderCall, "CallExpression") &&
      isNodeOfType(renderCall.callee, "MemberExpression")
        ? stripParenExpression(renderCall.callee.object)
        : null;
    const allocationReceiver = isNodeOfType(mapCall.callee, "MemberExpression")
      ? stripParenExpression(mapCall.callee.object)
      : null;
    const isSameReceiverRenderMap = Boolean(
      isNodeOfType(renderFunction, "ArrowFunctionExpression") &&
      !renderFunction.async &&
      isNodeOfType(renderCall, "CallExpression") &&
      !renderCall.optional &&
      renderCall.arguments.length === INLINE_MAP_ARGUMENT_COUNT &&
      renderCall.arguments[INLINE_MAP_FIRST_ARGUMENT_INDEX] === renderRoot &&
      isNodeOfType(renderCall.callee, "MemberExpression") &&
      !renderCall.callee.optional &&
      !renderCall.callee.computed &&
      getStaticPropertyName(renderCall.callee) === "map" &&
      isNodeOfType(renderReceiver, "Identifier") &&
      isNodeOfType(allocationReceiver, "Identifier") &&
      scopes.symbolFor(renderReceiver) &&
      scopes.symbolFor(renderReceiver) === scopes.symbolFor(allocationReceiver) &&
      findEnclosingFunction(renderCall) === owner &&
      isValueRenderedInSameRender(renderCall, scopes),
    );
    return Boolean(
      isNodeOfType(container, "JSXExpressionContainer") &&
      container.expression === functionRoot &&
      INLINE_MAP_NATIVE_EVENT_NAMES.has(eventName ?? "") &&
      isNodeOfType(opening, "JSXOpeningElement") &&
      isProvenIntrinsicJsxElement(opening, scopes) &&
      !hasJsxSpreadAttribute(opening.attributes) &&
      opening.attributes.filter(
        (candidate) =>
          isNodeOfType(candidate, "JSXAttribute") &&
          isNodeOfType(candidate.name, "JSXIdentifier") &&
          candidate.name.name === eventName,
      ).length === INLINE_MAP_EVENT_ATTRIBUTE_COUNT &&
      isNodeOfType(opening.parent, "JSXElement") &&
      isValueRenderedInSameRender(opening.parent, scopes) &&
      (renderFunction === owner || isSameReceiverRenderMap),
    );
  };
  return symbol.references.some((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    const element = root.parent;
    const observer = findEnclosingFunction(reference.identifier);
    if (
      !observer ||
      observer === owner ||
      !isNodeOfType(element, "MemberExpression") ||
      element.object !== root ||
      !element.computed
    )
      return false;
    const index = stripParenExpression(element.property);
    const indexSymbol = isNodeOfType(index, "Identifier") ? scopes.symbolFor(index) : null;
    const isNumericIndex =
      (isNodeOfType(index, "Literal") &&
        typeof index.value === "number" &&
        Number.isSafeInteger(index.value) &&
        index.value >= INLINE_MAP_MINIMUM_ELEMENT_INDEX) ||
      (indexSymbol?.kind === "parameter" &&
        isNodeOfType(getSymbolTypeAnnotation(indexSymbol), "TSNumberKeyword") &&
        indexSymbol.references.every(
          (indexReference) =>
            indexReference.flag === "read" && !isWithinAssignmentTarget(indexReference.identifier),
        ));
    const elementRoot = findTransparentExpressionRoot(element);
    const current = elementRoot.parent;
    if (
      !isNumericIndex ||
      !isNodeOfType(current, "MemberExpression") ||
      current.object !== elementRoot ||
      getStaticPropertyName(current) !== "current"
    )
      return false;
    const observerRoot = findTransparentExpressionRoot(observer);
    if (
      (isEffectCallbackReference(observer, scopes) &&
        observerRoot.parent &&
        findEnclosingFunction(observerRoot.parent) === owner) ||
      isNativeEventCallback(observer)
    )
      return true;
    if (findEnclosingFunction(observer) !== owner) return false;
    const binding = getFunctionBindingIdentifier(observer);
    if (!binding) return false;
    let observerSymbol: SymbolDescriptor | null;
    if (isNodeOfType(observer, "FunctionDeclaration")) {
      const scope = scopes.scopeFor(observer);
      let symbolsByBinding = observerSymbolsByScope.get(scope);
      if (!symbolsByBinding) {
        symbolsByBinding = new WeakMap();
        for (const candidate of scope.symbols) {
          let symbolsByDeclaration = symbolsByBinding.get(candidate.bindingIdentifier);
          if (!symbolsByDeclaration) {
            symbolsByDeclaration = new WeakMap();
            symbolsByBinding.set(candidate.bindingIdentifier, symbolsByDeclaration);
          }
          if (!symbolsByDeclaration.has(candidate.declarationNode))
            symbolsByDeclaration.set(candidate.declarationNode, candidate);
        }
        observerSymbolsByScope.set(scope, symbolsByBinding);
      }
      observerSymbol = symbolsByBinding.get(binding)?.get(observer) ?? null;
    } else observerSymbol = scopes.symbolFor(binding);
    if (
      !observerSymbol ||
      (observerSymbol.kind !== "function" &&
        !(observerSymbol.kind === "const" && observerSymbol.initializer === observer)) ||
      observerSymbol.references.some(
        (observerReference) =>
          observerReference.flag !== "read" ||
          isWithinAssignmentTarget(observerReference.identifier),
      )
    )
      return false;
    return observerSymbol.references.some((observerReference) => {
      const calledRoot = findTransparentExpressionRoot(observerReference.identifier);
      const call = calledRoot.parent;
      const eventCallback = findEnclosingFunction(calledRoot);
      return Boolean(
        isNodeOfType(call, "CallExpression") &&
        !call.optional &&
        call.callee === calledRoot &&
        eventCallback &&
        isNativeEventCallback(eventCallback),
      );
    });
  });
};
