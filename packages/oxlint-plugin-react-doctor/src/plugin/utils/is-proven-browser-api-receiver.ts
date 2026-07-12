import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getSymbolTypeAnnotation } from "./get-symbol-type-annotation.js";
import { hasEnclosingTypeParameterNamed } from "./has-enclosing-type-parameter-named.js";
import { hasVisibleBindingNamed } from "./has-visible-binding-named.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const DOM_EVENT_TARGET_TYPE_NAMES = new Set([
  "AbortSignal",
  "Document",
  "DocumentFragment",
  "Element",
  "EventTarget",
  "HTMLElement",
  "MediaQueryList",
  "Node",
  "ShadowRoot",
  "SVGElement",
  "Window",
  "XMLDocument",
]);
const DOM_ELEMENT_TYPE_NAME_PATTERN = /^(?:HTML|SVG)[A-Za-z0-9]+Element$/;
const DOM_EVENT_TARGET_CONSTRUCTOR_NAMES = new Set([
  "DocumentFragment",
  "EventTarget",
  "Image",
  "Option",
]);
const DOM_EVENT_TARGET_FACTORY_METHOD_NAMES = new Set([
  "cloneNode",
  "closest",
  "createElement",
  "createElementNS",
  "elementFromPoint",
  "getElementById",
  "getRootNode",
  "querySelector",
]);
const DOM_EVENT_TARGET_MEMBER_NAMES = new Set([
  "activeElement",
  "body",
  "documentElement",
  "firstElementChild",
  "lastElementChild",
  "ownerDocument",
  "parentElement",
  "shadowRoot",
]);

const isDomEventTargetTypeName = (typeName: string): boolean =>
  DOM_EVENT_TARGET_TYPE_NAMES.has(typeName) || DOM_ELEMENT_TYPE_NAME_PATTERN.test(typeName);

const isTargetTypeName = (
  typeName: string,
  receiverKind: "dom-event-target" | "xml-http-request",
): boolean =>
  receiverKind === "xml-http-request"
    ? typeName === "XMLHttpRequest"
    : isDomEventTargetTypeName(typeName);

const isUnshadowedTargetType = (
  typeNode: EsTreeNode,
  scopes: ScopeAnalysis,
  receiverKind: "dom-event-target" | "xml-http-request",
): boolean => {
  if (isNodeOfType(typeNode, "TSTypeReference")) {
    if (!isNodeOfType(typeNode.typeName, "Identifier")) return false;
    const typeName = typeNode.typeName.name;
    return (
      isTargetTypeName(typeName, receiverKind) &&
      !hasVisibleBindingNamed(typeNode, typeName, scopes) &&
      !hasEnclosingTypeParameterNamed(typeNode, typeName)
    );
  }
  if (!isNodeOfType(typeNode, "TSUnionType")) return false;

  let hasTargetType = false;
  for (const unionMember of typeNode.types) {
    if (
      isNodeOfType(unionMember, "TSNullKeyword") ||
      isNodeOfType(unionMember, "TSUndefinedKeyword")
    ) {
      continue;
    }
    if (!isUnshadowedTargetType(unionMember, scopes, receiverKind)) return false;
    hasTargetType = true;
  }
  return hasTargetType;
};

const isGlobalIdentifier = (
  node: EsTreeNode,
  identifierName: string,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(node, "Identifier") &&
  node.name === identifierName &&
  scopes.isGlobalReference(node);

const isGlobalConstructorReference = (
  rawExpression: EsTreeNode,
  constructorName: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Identifier")) {
    if (expression.name === constructorName && scopes.isGlobalReference(expression)) return true;
    const symbol = scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return false;
    visitedSymbolIds.add(symbol.id);
    return isGlobalConstructorReference(initializer, constructorName, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(expression, "MemberExpression")) return false;
  if (getStaticPropertyName(expression) !== constructorName) return false;
  const object = stripParenExpression(expression.object);
  return (
    isGlobalIdentifier(object, "window", scopes) || isGlobalIdentifier(object, "globalThis", scopes)
  );
};

const hasTypedReactRefOrigin = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  let expression = stripParenExpression(rawExpression);
  while (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return false;
    visitedSymbolIds.add(symbol.id);
    expression = stripParenExpression(initializer);
  }
  if (!isNodeOfType(expression, "CallExpression")) return false;
  if (
    !isReactApiCall(expression, "useRef", scopes, {
      allowGlobalReactNamespace: false,
      allowUnboundBareCalls: false,
    }) &&
    !isReactApiCall(expression, "createRef", scopes, {
      allowGlobalReactNamespace: false,
      allowUnboundBareCalls: false,
    })
  ) {
    return false;
  }
  if (!isNodeOfType(expression.typeArguments, "TSTypeParameterInstantiation")) return false;
  const typeArgument = expression.typeArguments.params[0];
  return Boolean(typeArgument && isUnshadowedTargetType(typeArgument, scopes, "dom-event-target"));
};

const isProvenDomEventTarget = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Identifier")) {
    if (
      isGlobalIdentifier(expression, "document", scopes) ||
      isGlobalIdentifier(expression, "window", scopes)
    ) {
      return true;
    }
    const symbol = scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    const typeAnnotation = getSymbolTypeAnnotation(symbol);
    if (typeAnnotation && isUnshadowedTargetType(typeAnnotation, scopes, "dom-event-target")) {
      return true;
    }
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return false;
    visitedSymbolIds.add(symbol.id);
    return isProvenDomEventTarget(initializer, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(expression, "NewExpression")) {
    for (const constructorName of DOM_EVENT_TARGET_CONSTRUCTOR_NAMES) {
      if (isGlobalConstructorReference(expression.callee, constructorName, scopes, new Set())) {
        return true;
      }
    }
    return false;
  }
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = stripParenExpression(expression.callee);
    return (
      isNodeOfType(callee, "MemberExpression") &&
      DOM_EVENT_TARGET_FACTORY_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
      isProvenDomEventTarget(callee.object, scopes, visitedSymbolIds)
    );
  }
  if (!isNodeOfType(expression, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(expression);
  if (propertyName === "current") {
    return hasTypedReactRefOrigin(expression.object, scopes, visitedSymbolIds);
  }
  const object = stripParenExpression(expression.object);
  if (
    propertyName === "document" &&
    (isGlobalIdentifier(object, "window", scopes) ||
      isGlobalIdentifier(object, "globalThis", scopes))
  ) {
    return true;
  }
  return (
    propertyName !== null &&
    DOM_EVENT_TARGET_MEMBER_NAMES.has(propertyName) &&
    isProvenDomEventTarget(object, scopes, visitedSymbolIds)
  );
};

const isProvenXmlHttpRequest = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "NewExpression")) {
    return isGlobalConstructorReference(expression.callee, "XMLHttpRequest", scopes, new Set());
  }
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.symbolFor(expression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  const typeAnnotation = getSymbolTypeAnnotation(symbol);
  if (typeAnnotation && isUnshadowedTargetType(typeAnnotation, scopes, "xml-http-request")) {
    return true;
  }
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return false;
  visitedSymbolIds.add(symbol.id);
  return isProvenXmlHttpRequest(initializer, scopes, visitedSymbolIds);
};

export const isProvenBrowserApiReceiver = (
  receiver: EsTreeNode,
  receiverKind: "dom-event-target" | "xml-http-request",
  scopes: ScopeAnalysis,
): boolean =>
  receiverKind === "xml-http-request"
    ? isProvenXmlHttpRequest(receiver, scopes, new Set())
    : isProvenDomEventTarget(receiver, scopes, new Set());
