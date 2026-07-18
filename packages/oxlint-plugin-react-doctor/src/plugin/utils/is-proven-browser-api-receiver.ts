import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { functionReturnsMatchingExpression } from "./function-returns-matching-expression.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getSymbolTypeAnnotation } from "./get-symbol-type-annotation.js";
import { hasEnclosingTypeParameterNamed } from "./has-enclosing-type-parameter-named.js";
import { hasVisibleBindingNamed } from "./has-visible-binding-named.js";
import { isGlobalMatchMediaCall } from "./is-global-match-media-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isFunctionLike } from "./is-function-like.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const DOM_EVENT_TARGET_TYPE_NAMES = new Set([
  "AbortSignal",
  "Document",
  "DocumentFragment",
  "Element",
  "EventTarget",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLButtonElement",
  "HTMLCanvasElement",
  "HTMLDivElement",
  "HTMLFormElement",
  "HTMLIFrameElement",
  "HTMLImageElement",
  "HTMLInputElement",
  "HTMLLabelElement",
  "HTMLLIElement",
  "HTMLMediaElement",
  "HTMLParagraphElement",
  "HTMLSelectElement",
  "HTMLSpanElement",
  "HTMLTableElement",
  "HTMLTextAreaElement",
  "HTMLUListElement",
  "HTMLVideoElement",
  "MediaQueryList",
  "Node",
  "ShadowRoot",
  "SVGElement",
  "SVGSVGElement",
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
  "parentNode",
  "shadowRoot",
]);

const getDomPrototypeOwnerNamesForType = (typeName: string): readonly string[] => {
  if (typeName === "Window") return ["Window", "EventTarget"];
  if (typeName === "Document" || typeName === "XMLDocument") {
    return [typeName, "Node", "EventTarget"];
  }
  if (typeName === "DocumentFragment" || typeName === "ShadowRoot") {
    return [typeName, "Node", "EventTarget"];
  }
  if (typeName === "HTMLElement" || typeName.startsWith("HTML")) {
    return [typeName, "HTMLElement", "Element", "Node", "EventTarget"];
  }
  if (typeName === "SVGElement" || typeName.startsWith("SVG")) {
    return [typeName, "SVGElement", "Element", "Node", "EventTarget"];
  }
  if (typeName === "Element") return ["Element", "Node", "EventTarget"];
  if (typeName === "Node") return ["Node", "EventTarget"];
  return [typeName, "EventTarget"];
};

const isTargetTypeName = (
  typeName: string,
  receiverKind: "dom-event-target" | "xml-http-request",
): boolean =>
  receiverKind === "xml-http-request"
    ? typeName === "XMLHttpRequest"
    : DOM_EVENT_TARGET_TYPE_NAMES.has(typeName) || DOM_ELEMENT_TYPE_NAME_PATTERN.test(typeName);

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

const getUnshadowedDomTargetTypeName = (
  typeNode: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  if (
    !isNodeOfType(typeNode, "TSTypeReference") ||
    !isNodeOfType(typeNode.typeName, "Identifier") ||
    !isUnshadowedTargetType(typeNode, scopes, "dom-event-target")
  ) {
    return null;
  }
  return typeNode.typeName.name;
};

const isGlobalIdentifier = (
  node: EsTreeNode,
  identifierName: string,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(node, "Identifier") &&
  node.name === identifierName &&
  scopes.isGlobalReference(node);

export const getProvenDomEventTargetPrototypeOwnerNames = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): readonly string[] => {
  const expression = stripParenExpression(rawExpression);
  if (isGlobalIdentifier(expression, "window", scopes)) return ["Window", "EventTarget"];
  if (isGlobalIdentifier(expression, "document", scopes)) {
    return ["Document", "Node", "EventTarget"];
  }
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return ["EventTarget"];
    const typeAnnotation = getSymbolTypeAnnotation(symbol);
    const typeName = typeAnnotation ? getUnshadowedDomTargetTypeName(typeAnnotation, scopes) : null;
    if (typeName) return getDomPrototypeOwnerNamesForType(typeName);
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) return ["EventTarget"];
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    return getProvenDomEventTargetPrototypeOwnerNames(initializer, scopes, nextVisitedSymbolIds);
  }
  if (isNodeOfType(expression, "NewExpression")) {
    const callee = stripParenExpression(expression.callee);
    if (isNodeOfType(callee, "Identifier") && DOM_EVENT_TARGET_CONSTRUCTOR_NAMES.has(callee.name)) {
      const typeName =
        callee.name === "Image"
          ? "HTMLImageElement"
          : callee.name === "Option"
            ? "HTMLOptionElement"
            : callee.name;
      return getDomPrototypeOwnerNamesForType(typeName);
    }
  }
  if (isNodeOfType(expression, "MemberExpression")) {
    const memberName = getStaticPropertyName(expression);
    if (memberName === "body" || memberName === "documentElement") {
      return getDomPrototypeOwnerNamesForType("HTMLElement");
    }
  }
  if (isNodeOfType(expression, "CallExpression")) {
    if (isGlobalMatchMediaCall(expression, scopes)) {
      return getDomPrototypeOwnerNamesForType("MediaQueryList");
    }
    const callee = stripParenExpression(expression.callee);
    const methodName = isNodeOfType(callee, "MemberExpression")
      ? getStaticPropertyName(callee)
      : null;
    if (
      methodName === "matchMedia" &&
      isNodeOfType(callee, "MemberExpression") &&
      getProvenDomEventTargetPrototypeOwnerNames(callee.object, scopes, visitedSymbolIds).includes(
        "Window",
      )
    ) {
      return getDomPrototypeOwnerNamesForType("MediaQueryList");
    }
    if (methodName === "createElement") {
      return getDomPrototypeOwnerNamesForType("HTMLElement");
    }
    if (methodName === "createElementNS") {
      return getDomPrototypeOwnerNamesForType("SVGElement");
    }
    if (methodName && DOM_EVENT_TARGET_FACTORY_METHOD_NAMES.has(methodName)) {
      return getDomPrototypeOwnerNamesForType("Element");
    }
  }
  return ["EventTarget"];
};

const isProvenTargetConstructorCall = (
  callee: EsTreeNode,
  receiverKind: "dom-event-target" | "xml-http-request",
  scopes: ScopeAnalysis,
): boolean => {
  const constructorNames =
    receiverKind === "xml-http-request"
      ? ["XMLHttpRequest"]
      : [...DOM_EVENT_TARGET_CONSTRUCTOR_NAMES];
  return constructorNames.some((constructorName) =>
    isGlobalConstructorReference(callee, constructorName, scopes, new Set()),
  );
};

const hasAssertedTargetType = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  receiverKind: "dom-event-target" | "xml-http-request",
): boolean => {
  let wrapper = expression;
  let didFindTargetAssertion = false;
  while (
    isNodeOfType(wrapper, "TSAsExpression") ||
    isNodeOfType(wrapper, "TSTypeAssertion") ||
    isNodeOfType(wrapper, "TSSatisfiesExpression")
  ) {
    if (isUnshadowedTargetType(wrapper.typeAnnotation, scopes, receiverKind)) {
      didFindTargetAssertion = true;
    } else if (didFindTargetAssertion) {
      return false;
    }
    wrapper = wrapper.expression;
  }
  let assertedSource: EsTreeNode = wrapper;
  if (isNodeOfType(assertedSource, "Identifier")) {
    const assertedSymbol = scopes.symbolFor(assertedSource);
    const assertedInitializer = assertedSymbol ? getDirectConstInitializer(assertedSymbol) : null;
    if (!assertedInitializer) return false;
    assertedSource = stripParenExpression(assertedInitializer);
  }
  if (didFindTargetAssertion && isNodeOfType(assertedSource, "Identifier")) return false;
  if (didFindTargetAssertion && isNodeOfType(assertedSource, "MemberExpression")) return false;
  if (didFindTargetAssertion && isNodeOfType(assertedSource, "ObjectExpression")) return false;
  if (didFindTargetAssertion && isNodeOfType(assertedSource, "NewExpression")) {
    return isProvenTargetConstructorCall(assertedSource.callee, receiverKind, scopes);
  }
  return didFindTargetAssertion;
};

const getClassMemberDefinition = (memberExpression: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(memberExpression, "MemberExpression")) return null;
  if (!isNodeOfType(stripParenExpression(memberExpression.object), "ThisExpression")) return null;
  const propertyName = getStaticPropertyName(memberExpression);
  if (!propertyName) return null;
  let ancestor = memberExpression.parent;
  while (ancestor && !isNodeOfType(ancestor, "ClassBody")) {
    if (
      (isNodeOfType(ancestor, "FunctionDeclaration") ||
        isNodeOfType(ancestor, "FunctionExpression")) &&
      !isNodeOfType(ancestor.parent, "MethodDefinition")
    ) {
      return null;
    }
    ancestor = ancestor.parent;
  }
  if (!ancestor) return null;
  for (const classElement of ancestor.body) {
    if (!isNodeOfType(classElement, "PropertyDefinition") || classElement.static) continue;
    if (getStaticKeyName(classElement.key) === propertyName) return classElement;
  }
  return null;
};

const getClassMemberTypeAnnotation = (classMember: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(classMember, "PropertyDefinition")) return null;
  const annotation = classMember.typeAnnotation;
  return annotation && isNodeOfType(annotation, "TSTypeAnnotation")
    ? annotation.typeAnnotation
    : null;
};

const getSameFileCalledFunction = (
  callExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode | null => {
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const symbol = scopes.symbolFor(callee);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  if (
    symbol.kind !== "const" &&
    !(
      symbol.kind === "function" &&
      symbol.references.every((reference) => reference.flag === "read")
    )
  ) {
    return null;
  }
  const candidate = symbol.initializer ?? symbol.declarationNode;
  if (!isFunctionLike(candidate) || candidate.async || candidate.generator) return null;
  visitedSymbolIds.add(symbol.id);
  return candidate;
};

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

export const isProvenBrowserApiReceiver = (
  receiver: EsTreeNode,
  receiverKind: "dom-event-target" | "xml-http-request",
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const isDomEventTarget = receiverKind === "dom-event-target";
  if (hasAssertedTargetType(receiver, scopes, receiverKind)) return true;
  const expression = stripParenExpression(receiver);
  if (isNodeOfType(expression, "Identifier")) {
    if (
      isDomEventTarget &&
      (isGlobalIdentifier(expression, "document", scopes) ||
        isGlobalIdentifier(expression, "window", scopes))
    ) {
      return true;
    }
    const symbol = scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    const typeAnnotation = getSymbolTypeAnnotation(symbol);
    if (typeAnnotation && isUnshadowedTargetType(typeAnnotation, scopes, receiverKind)) return true;
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) return false;
    visitedSymbolIds.add(symbol.id);
    return isProvenBrowserApiReceiver(initializer, receiverKind, scopes, visitedSymbolIds);
  }
  if (isNodeOfType(expression, "NewExpression")) {
    return isProvenTargetConstructorCall(expression.callee, receiverKind, scopes);
  }
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = stripParenExpression(expression.callee);
    if (
      isDomEventTarget &&
      isNodeOfType(callee, "MemberExpression") &&
      DOM_EVENT_TARGET_FACTORY_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
      isProvenBrowserApiReceiver(callee.object, receiverKind, scopes, visitedSymbolIds)
    ) {
      return true;
    }
    const calledFunction = getSameFileCalledFunction(expression, scopes, visitedSymbolIds);
    return Boolean(
      calledFunction &&
      functionReturnsMatchingExpression(
        calledFunction,
        scopes,
        (returnedExpression) =>
          isProvenBrowserApiReceiver(
            returnedExpression,
            receiverKind,
            scopes,
            new Set(visitedSymbolIds),
          ),
        undefined,
        "every",
      ),
    );
  }
  if (!isNodeOfType(expression, "MemberExpression")) return false;
  const classMember = getClassMemberDefinition(expression);
  if (classMember && isNodeOfType(classMember, "PropertyDefinition")) {
    const classMemberType = getClassMemberTypeAnnotation(classMember);
    if (classMemberType && isUnshadowedTargetType(classMemberType, scopes, receiverKind)) {
      return true;
    }
    if (
      classMember.value &&
      isProvenBrowserApiReceiver(classMember.value, receiverKind, scopes, visitedSymbolIds)
    ) {
      return true;
    }
  }
  if (!isDomEventTarget) return false;
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
    isProvenBrowserApiReceiver(object, receiverKind, scopes, visitedSymbolIds)
  );
};
