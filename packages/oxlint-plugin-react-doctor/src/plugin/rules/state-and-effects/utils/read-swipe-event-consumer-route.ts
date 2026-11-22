import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getExecutableValueReferences } from "../../../utils/get-executable-value-references.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { readClosedNativeEventConsumer } from "./read-closed-native-event-consumer.js";
import type { ClosedNativeEventConsumer } from "./read-closed-native-event-consumer.js";

export interface SwipeEventConsumers {
  readonly onSwiping: ClosedNativeEventConsumer;
  readonly onSwiped: ClosedNativeEventConsumer;
}

interface SwipeEventRoute {
  readonly callerOpening: EsTreeNodeOfType<"JSXOpeningElement">;
  readonly callerScopes: ScopeAnalysis;
  readonly leafComponent: EsTreeNode;
  readonly wrapperOpening: EsTreeNodeOfType<"JSXOpeningElement">;
  readonly leafScopes: ScopeAnalysis;
  readonly forwardingHook: EsTreeNodeOfType<"CallExpression">;
}

const readAttributes = (opening: EsTreeNodeOfType<"JSXOpeningElement">) => {
  const attributes = new Map<string, EsTreeNode>();
  const seen = new Set<string>();
  for (const attribute of opening.attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      seen.has(attribute.name.name)
    )
      return null;
    seen.add(attribute.name.name);
    if (isNodeOfType(attribute.value, "JSXExpressionContainer")) {
      attributes.set(attribute.name.name, attribute.value.expression);
    } else if (attribute.name.name === "onSwiping" || attribute.name.name === "onSwiped") {
      return null;
    }
  }
  return attributes;
};

const readForwardedValue = (value: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode | null => {
  const expression = stripParenExpression(value);
  if (isNodeOfType(expression, "Identifier")) return expression;
  if (
    !isNodeOfType(expression, "ConditionalExpression") ||
    !isNodeOfType(expression.test, "UnaryExpression") ||
    expression.test.operator !== "!" ||
    !isNodeOfType(expression.test.argument, "Identifier")
  )
    return null;
  const absent = (node: EsTreeNode): boolean =>
    isNodeOfType(node, "Identifier") && node.name === "undefined" && !scopes.symbolFor(node);
  const present = stripParenExpression(expression.consequent);
  return absent(expression.alternate) &&
    isNodeOfType(present, "LogicalExpression") &&
    present.operator === "??" &&
    isNodeOfType(present.left, "Identifier") &&
    absent(present.right)
    ? present.left
    : null;
};

const isOnlyRead = (binding: EsTreeNode, reference: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbol = scopes.symbolFor(binding);
  if (
    !symbol ||
    symbol.bindingIdentifier !== binding ||
    scopes.symbolFor(reference) !== symbol ||
    !hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
  )
    return false;
  const reads = getExecutableValueReferences(symbol);
  return reads.length === 1 && reads[0].flag === "read" && reads[0].identifier === reference;
};

const readCallerConsumer = (
  value: EsTreeNode,
  route: SwipeEventRoute,
): ClosedNativeEventConsumer | null => {
  const reference = stripParenExpression(value);
  if (!isNodeOfType(reference, "Identifier")) return null;
  const scopes = route.callerScopes;
  const binding = scopes.symbolFor(reference);
  if (
    !binding ||
    !isOnlyRead(binding.bindingIdentifier, reference, scopes) ||
    findEnclosingFunction(binding.bindingIdentifier) !== findEnclosingFunction(route.callerOpening)
  )
    return null;
  const initializer = getDirectConstInitializer(binding);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length !== 2 ||
    !isNodeOfType(initializer.arguments[1], "ArrayExpression")
  )
    return null;
  const api = resolveImportedApiReference(initializer.callee, scopes);
  if (api?.source !== "react" || api.importedName !== "useCallback") return null;
  return readClosedNativeEventConsumer(initializer.arguments[0], scopes);
};

export const readSwipeEventConsumerRoute = (route: SwipeEventRoute): SwipeEventConsumers | null => {
  const { leafComponent, leafScopes, wrapperOpening, forwardingHook } = route;
  const callerAttributes = readAttributes(route.callerOpening);
  const wrapperAttributes = readAttributes(wrapperOpening);
  const config = forwardingHook.arguments[0];
  if (
    (!isNodeOfType(leafComponent, "FunctionExpression") &&
      !isNodeOfType(leafComponent, "ArrowFunctionExpression")) ||
    leafComponent.params.length !== 1 ||
    !isNodeOfType(leafComponent.params[0], "ObjectPattern") ||
    findEnclosingFunction(wrapperOpening) !== leafComponent ||
    !isNodeOfType(config, "ObjectExpression") ||
    !callerAttributes ||
    !wrapperAttributes ||
    [route.callerScopes, leafScopes].some((scopes) =>
      someAst(
        scopes.rootScope.node,
        (node) =>
          isNodeOfType(node, "WithStatement") ||
          (isNodeOfType(node, "Identifier") && node.name === "eval"),
      ),
    )
  )
    return null;
  const parameter = leafComponent.params[0];
  if (
    parameter.properties.some(
      (property) => !isNodeOfType(property, "Property") || property.computed,
    )
  )
    return null;

  const readField = (name: string): ClosedNativeEventConsumer | null => {
    const callerValue = callerAttributes.get(name);
    const wrapperValue = wrapperAttributes.get(name);
    const field = parameter.properties.filter(
      (property) => getStaticPropertyKeyName(property) === name,
    );
    const [declaration] = field;
    if (
      !callerValue ||
      !wrapperValue ||
      field.length !== 1 ||
      !isNodeOfType(declaration, "Property") ||
      !isNodeOfType(declaration.value, "Identifier") ||
      !config.properties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          !property.computed &&
          getStaticPropertyKeyName(property) === name,
      )
    )
      return null;
    const forwarded = readForwardedValue(wrapperValue, leafScopes);
    if (!forwarded || !isOnlyRead(declaration.value, forwarded, leafScopes)) return null;
    return readCallerConsumer(callerValue, route);
  };
  const onSwiping = readField("onSwiping");
  const onSwiped = readField("onSwiped");
  return onSwiping && onSwiped ? { onSwiping, onSwiped } : null;
};
