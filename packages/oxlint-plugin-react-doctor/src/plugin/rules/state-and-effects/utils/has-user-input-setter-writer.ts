import type { Reference, Variable } from "eslint-scope";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import {
  getFunctionBindingIdentifier,
  getFunctionBindingName,
} from "../../../utils/get-function-binding-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { isEventHandlerName } from "./event-handler-reference.js";
import { getCallExpr } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { isGenuineReactHookDeclarator } from "./effect/react.js";
import { isSetterWiredToJsxHandler } from "./is-controlled-prop-mirror.js";

const HANDLER_BINDING_NAME_PATTERN = /^(on|handle)[A-Z_]/;

const isEventHandlerPropertyKey = (property: EsTreeNode): boolean =>
  isNodeOfType(property, "Property") &&
  !property.computed &&
  isNodeOfType(property.key, "Identifier") &&
  isEventHandlerName(property.key.name);

const DEFERRED_CALLBACK_MEMBER_NAMES = new Set(["then", "catch", "finally", "subscribe"]);
const DEFERRED_CALLBACK_CALLEE_NAMES = new Set([
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "addEventListener",
  "addListener",
]);

const isDeferredCallbackArgumentOf = (callExpr: EsTreeNode, child: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  if (!(callExpr.arguments ?? []).includes(child as (typeof callExpr.arguments)[number])) {
    return false;
  }
  const callee = callExpr.callee;
  if (isNodeOfType(callee, "Identifier")) return DEFERRED_CALLBACK_CALLEE_NAMES.has(callee.name);
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return (
      DEFERRED_CALLBACK_MEMBER_NAMES.has(callee.property.name) ||
      DEFERRED_CALLBACK_CALLEE_NAMES.has(callee.property.name)
    );
  }
  return false;
};

// True when this setter reference sits in a user-input write path: inside
// a JSX `on*` attribute value, inside an `on*`-keyed object property
// (gesture/config callbacks), or inside a component-body function that is
// itself a handler — named `on*`/`handle*`, or wired into a JSX `on*`
// attribute anywhere in the component. `includeDeferredWriters` extends
// the classification to async writers: subscription / promise / timer
// callbacks and `async` functions.
const isIndependentWriterIdentifier = (
  componentFunction: EsTreeNode,
  identifier: EsTreeNode,
  includeDeferredWriters: boolean,
): boolean => {
  let outermostFunctionBelowComponent: EsTreeNode | null = null;
  let previous: EsTreeNode = identifier;
  let cursor: EsTreeNode | null | undefined = identifier.parent;
  while (cursor && cursor !== componentFunction) {
    if (isNodeOfType(cursor, "JSXAttribute")) {
      const attributeName = getJsxAttributeName(cursor.name);
      if (attributeName && isEventHandlerName(attributeName)) return true;
    }
    if (isEventHandlerPropertyKey(cursor)) return true;
    if (includeDeferredWriters && isDeferredCallbackArgumentOf(cursor, previous)) return true;
    if (isFunctionLike(cursor)) {
      outermostFunctionBelowComponent = cursor;
      if (includeDeferredWriters && (cursor as unknown as { async?: boolean }).async === true) {
        return true;
      }
    }
    previous = cursor;
    cursor = cursor.parent ?? null;
  }
  if (!outermostFunctionBelowComponent) return false;
  const bindingName = getFunctionBindingName(outermostFunctionBelowComponent);
  if (!bindingName) return false;
  if (HANDLER_BINDING_NAME_PATTERN.test(bindingName)) return true;
  return isSetterWiredToJsxHandler(componentFunction, bindingName);
};

const isSynchronousFunction = (functionNode: EsTreeNode): boolean => {
  const functionMetadata = functionNode as unknown as { async?: boolean; generator?: boolean };
  return functionMetadata.async !== true && functionMetadata.generator !== true;
};

const findBindingVariable = (
  analysis: ProgramAnalysis,
  bindingIdentifier: EsTreeNode,
): Variable | null => {
  for (const scope of analysis.scopeManager.scopes) {
    for (const variable of scope.variables) {
      if (variable.identifiers.includes(bindingIdentifier as never)) return variable;
    }
  }
  return null;
};

const getImmutableFunctionVariable = (
  analysis: ProgramAnalysis,
  componentFunction: EsTreeNode,
  functionNode: EsTreeNode,
): Variable | null => {
  if (!isSynchronousFunction(functionNode) || !isAstDescendant(functionNode, componentFunction)) {
    return null;
  }
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return null;
  const variable = findBindingVariable(analysis, bindingIdentifier);
  if (
    !variable ||
    variable.defs.length !== 1 ||
    variable.references.some((reference) => reference.isWrite() && !reference.init)
  ) {
    return null;
  }
  const definition = variable.defs[0];
  if (definition.type === "FunctionName") {
    return definition.node === functionNode ? variable : null;
  }
  if (definition.type !== "Variable") return null;
  const declarator = definition.node as unknown as EsTreeNode;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const"
  ) {
    return null;
  }
  if (declarator.init === functionNode) return variable;
  if (
    isNodeOfType(declarator.init, "CallExpression") &&
    declarator.init.arguments?.[0] === functionNode &&
    isGenuineReactHookDeclarator(analysis, declarator, "useCallback")
  ) {
    return variable;
  }
  return null;
};

const getJsxEventValueAttribute = (identifier: EsTreeNode): EsTreeNode | null => {
  const expression = findTransparentExpressionRoot(identifier);
  const expressionContainer = expression.parent;
  if (
    !isNodeOfType(expressionContainer, "JSXExpressionContainer") ||
    expressionContainer.expression !== expression
  ) {
    return null;
  }
  const attribute = expressionContainer.parent;
  if (!isNodeOfType(attribute, "JSXAttribute")) return null;
  const attributeName = getJsxAttributeName(attribute.name);
  return attributeName && isEventHandlerName(attributeName) ? attribute : null;
};

const getInlineJsxEventCallbackAttribute = (callExpression: EsTreeNode): EsTreeNode | null => {
  const callbackFunction = findEnclosingFunction(callExpression);
  if (!callbackFunction || !isSynchronousFunction(callbackFunction)) return null;
  return getJsxEventValueAttribute(callbackFunction);
};

const isReactHookDependencyReference = (identifier: EsTreeNode): boolean => {
  const expression = findTransparentExpressionRoot(identifier);
  const dependencyArray = expression.parent;
  if (
    !isNodeOfType(dependencyArray, "ArrayExpression") ||
    !(dependencyArray.elements ?? []).includes(expression as never)
  ) {
    return false;
  }
  const hookCall = dependencyArray.parent;
  if (!isNodeOfType(hookCall, "CallExpression") || hookCall.arguments?.[1] !== dependencyArray) {
    return false;
  }
  const callee = hookCall.callee;
  if (isNodeOfType(callee, "Identifier")) return /^use[A-Z0-9]/.test(callee.name);
  return Boolean(
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    /^use[A-Z0-9]/.test(callee.property.name),
  );
};

const hasReachableJsxEventCallPath = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  componentFunction: EsTreeNode,
  functionVariable: Variable,
  visitedVariables: ReadonlySet<Variable>,
): boolean => {
  if (visitedVariables.has(functionVariable)) return false;
  const nextVisitedVariables = new Set(visitedVariables).add(functionVariable);
  const callExpressions: EsTreeNode[] = [];
  let hasDirectJsxEventReference = false;
  for (const reference of functionVariable.references) {
    if (reference.init) continue;
    const identifier = reference.identifier as unknown as EsTreeNode;
    if (reference.isWrite()) return false;
    const jsxEventValueAttribute = getJsxEventValueAttribute(identifier);
    if (jsxEventValueAttribute) {
      if (isNodeReachableWithinFunction(jsxEventValueAttribute, context)) {
        hasDirectJsxEventReference = true;
      }
      continue;
    }
    if (isReactHookDependencyReference(identifier)) continue;
    const callExpression = getCallExpr(reference);
    if (!callExpression) return false;
    const jsxEventCallbackAttribute = getInlineJsxEventCallbackAttribute(callExpression);
    if (jsxEventCallbackAttribute) {
      if (
        isNodeReachableWithinFunction(callExpression, context) &&
        isNodeReachableWithinFunction(jsxEventCallbackAttribute, context)
      ) {
        hasDirectJsxEventReference = true;
      }
      continue;
    }
    callExpressions.push(callExpression);
  }
  if (hasDirectJsxEventReference) return true;
  for (const callExpression of callExpressions) {
    if (!isNodeReachableWithinFunction(callExpression, context)) continue;
    const callerFunction = findEnclosingFunction(callExpression);
    if (!callerFunction || callerFunction === componentFunction) continue;
    const callerVariable = getImmutableFunctionVariable(
      analysis,
      componentFunction,
      callerFunction,
    );
    if (
      callerVariable &&
      hasReachableJsxEventCallPath(
        analysis,
        context,
        componentFunction,
        callerVariable,
        nextVisitedVariables,
      )
    ) {
      return true;
    }
  }
  return false;
};

// The state behind `setterRef` has an independent writer: some OTHER
// reference to the same setter binding (outside the flagged effect)
// writes it from an event-handler path — or, with
// `includeDeferredWriters`, from a subscription / promise / timer / async
// callback. Such state carries information (user input, async results)
// that no render-time derivation can reproduce.
export const hasUserInputSetterWriter = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  setterRef: Reference,
  effectNode: EsTreeNode,
  includeDeferredWriters = false,
): boolean => {
  if (!setterRef.resolved) return false;
  const componentFunction = findEnclosingFunction(effectNode);
  if (!componentFunction) return false;
  for (const reference of setterRef.resolved.references) {
    if (reference.init) continue;
    const identifier = reference.identifier as unknown as EsTreeNode;
    if (isAstDescendant(identifier, effectNode)) continue;
    if (isIndependentWriterIdentifier(componentFunction, identifier, includeDeferredWriters)) {
      return true;
    }
    if (!isNodeReachableWithinFunction(identifier, context)) continue;
    const writerFunction = findEnclosingFunction(identifier);
    if (!writerFunction || writerFunction === componentFunction) continue;
    const writerVariable = getImmutableFunctionVariable(
      analysis,
      componentFunction,
      writerFunction,
    );
    if (
      writerVariable &&
      hasReachableJsxEventCallPath(analysis, context, componentFunction, writerVariable, new Set())
    ) {
      return true;
    }
  }
  return false;
};
