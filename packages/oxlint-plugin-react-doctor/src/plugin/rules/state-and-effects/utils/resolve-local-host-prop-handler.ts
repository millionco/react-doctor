import { hasOnlyReadonlySymbolReferences } from "../../../utils/has-only-readonly-symbol-references.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isComponentFunction } from "../../../utils/is-component-function.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { hasClosedHandlerStateSetters } from "./has-closed-handler-state-setters.js";

interface ResolveLocalHostPropHandlerOptions {
  attribute: EsTreeNodeOfType<"JSXAttribute">;
  context: RuleContext;
  eventHandlerNames: ReadonlySet<string>;
  stateHookNames: ReadonlySet<string>;
  matchesStateSetterCall: (node: EsTreeNode) => boolean;
  fulfillmentSetterForAwait: (node: EsTreeNode) => EsTreeNode | null;
}

const hasDirectFunctionBinding = (frame: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const symbols = getFunctionBindingSymbols(frame, scopes);
  if (!symbols.length || !symbols.every(hasOnlyReadonlySymbolReferences)) return false;
  if (
    !isNodeOfType(frame, "FunctionDeclaration") &&
    (!isNodeOfType(frame.parent, "VariableDeclarator") ||
      frame.parent.init !== frame ||
      !isNodeOfType(frame.parent.id, "Identifier") ||
      !isNodeOfType(frame.parent.parent, "VariableDeclaration") ||
      frame.parent.parent.kind !== "const")
  )
    return false;
  return !scopes
    .ownScopeFor(frame)
    ?.symbols.some(
      (symbol) =>
        symbol.kind === "function" &&
        symbol.declarationNode === frame &&
        symbol.references.length > 0,
    );
};

const isSupportedJsxGuard = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "Identifier")) return true;
  if (isNodeOfType(expression, "Literal")) return typeof expression.value === "boolean";
  if (
    !isNodeOfType(expression, "BinaryExpression") ||
    (expression.operator !== "===" && expression.operator !== "!==")
  )
    return false;
  let literal: EsTreeNode;
  if (isNodeOfType(expression.left, "Identifier")) literal = expression.right;
  else if (isNodeOfType(expression.right, "Identifier")) literal = expression.left;
  else return false;
  return (
    isNodeOfType(literal, "Literal") &&
    (literal.value === null ||
      typeof literal.value === "string" ||
      typeof literal.value === "number" ||
      typeof literal.value === "boolean")
  );
};

const isReturnedJsx = (node: EsTreeNode, frame: EsTreeNode, context: RuleContext): boolean => {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    const parentType: string = parent.type;
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      (parent.operator === "??" || !isSupportedJsxGuard(parent.left))
    )
      return false;
    if (isNodeOfType(parent, "ConditionalExpression") && !isSupportedJsxGuard(parent.test))
      return false;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return (
        parent.argument === current &&
        findEnclosingFunction(parent) === frame &&
        isNodeReachableWithinFunction(node, context)
      );
    }
    if (parent === frame) {
      return (
        isNodeOfType(frame, "ArrowFunctionExpression") &&
        frame.body === current &&
        isNodeReachableWithinFunction(node, context)
      );
    }
    if (
      (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === current) ||
      (isNodeOfType(parent, "LogicalExpression") && parent.right === current) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === current || parent.alternate === current)) ||
      (parentType === "ParenthesizedExpression" &&
        "expression" in parent &&
        parent.expression === current) ||
      (isNodeOfType(parent, "JSXFragment") && parent.children.some((child) => child === current)) ||
      (isNodeOfType(parent, "JSXElement") &&
        isNodeOfType(parent.openingElement.name, "JSXIdentifier") &&
        /^[a-z]/.test(parent.openingElement.name.name) &&
        parent.children.some((child) => child === current))
    ) {
      current = parent;
      continue;
    }
    return false;
  }
  return false;
};

const getSoleAttribute = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  name: string,
): EsTreeNodeOfType<"JSXAttribute"> | null => {
  let selected: EsTreeNodeOfType<"JSXAttribute"> | null = null;
  for (const attribute of opening.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) return null;
    if (!isNodeOfType(attribute.name, "JSXIdentifier")) return null;
    if (attribute.name.name !== name) continue;
    if (selected) return null;
    selected = attribute;
  }
  return selected;
};

const getDirectAttribute = (identifier: EsTreeNode): EsTreeNodeOfType<"JSXAttribute"> | null => {
  const expression = identifier.parent;
  const attribute = expression?.parent;
  return isNodeOfType(expression, "JSXExpressionContainer") &&
    expression.expression === identifier &&
    isNodeOfType(attribute, "JSXAttribute") &&
    attribute.value === expression
    ? attribute
    : null;
};

export const resolveLocalHostPropHandler = (
  options: ResolveLocalHostPropHandlerOptions,
): EsTreeNode | null => {
  const { attribute, context, eventHandlerNames } = options;
  if (
    !attribute.value ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    !isNodeOfType(attribute.value.expression, "Identifier")
  )
    return null;
  const selectedReference = attribute.value.expression;
  const propSymbol = context.scopes.symbolFor(selectedReference);
  const child = findEnclosingFunction(attribute);
  if (
    !propSymbol ||
    propSymbol.kind !== "parameter" ||
    !hasOnlyReadonlySymbolReferences(propSymbol) ||
    !child ||
    !isFunctionLike(child) ||
    child.async ||
    child.generator ||
    !isComponentFunction(child) ||
    !hasDirectFunctionBinding(child, context.scopes)
  )
    return null;
  const [props, ...otherParameters] = child.params;
  if (!isNodeOfType(props, "ObjectPattern") || otherParameters.length) return null;
  let selectedProperty: EsTreeNodeOfType<"Property"> | null = null;
  const propNames = new Set<string>();
  for (const property of props.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.value, "Identifier")
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (!name || propNames.has(name) || name === "__proto__") return null;
    propNames.add(name);
    if (property.value === propSymbol.bindingIdentifier) selectedProperty = property;
  }
  if (!selectedProperty) return null;
  const propName = getStaticPropertyKeyName(selectedProperty);
  if (
    !propName ||
    propName === "key" ||
    propName === "ref" ||
    propName === "__self" ||
    propName === "__source" ||
    propName === "children"
  )
    return null;
  for (const reference of propSymbol.references) {
    const identifier = reference.identifier;
    if (
      selectedProperty.shorthand &&
      selectedProperty.key === identifier &&
      selectedProperty.value === propSymbol.bindingIdentifier
    )
      continue;
    const hostAttribute = getDirectAttribute(identifier);
    const opening = hostAttribute?.parent;
    if (
      !hostAttribute ||
      !isNodeOfType(hostAttribute.name, "JSXIdentifier") ||
      !eventHandlerNames.has(hostAttribute.name.name) ||
      !isNodeOfType(opening, "JSXOpeningElement") ||
      !isNodeOfType(opening.name, "JSXIdentifier") ||
      !/^[a-z]/.test(opening.name.name) ||
      getSoleAttribute(opening, hostAttribute.name.name) !== hostAttribute ||
      findEnclosingFunction(hostAttribute) !== child ||
      !isNodeOfType(opening.parent, "JSXElement") ||
      !isReturnedJsx(opening.parent, child, context)
    )
      return null;
  }
  let selectedHandler: EsTreeNode | null = null;
  const suppliedAttributes = new Set<EsTreeNode>();
  for (const symbol of getFunctionBindingSymbols(child, context.scopes)) {
    for (const reference of symbol.references) {
      const identifier = reference.identifier;
      const tag = identifier.parent;
      if (
        !isNodeOfType(identifier, "JSXIdentifier") ||
        (!isNodeOfType(tag, "JSXOpeningElement") && !isNodeOfType(tag, "JSXClosingElement")) ||
        tag.name !== identifier ||
        !isNodeOfType(tag.parent, "JSXElement")
      )
        return null;
      const element = tag.parent;
      const owner = findEnclosingFunction(element);
      const supplied = getSoleAttribute(element.openingElement, propName);
      if (
        !owner ||
        owner === child ||
        !isFunctionLike(owner) ||
        owner.async ||
        owner.generator ||
        !isComponentFunction(owner) ||
        !isReturnedJsx(element, owner, context) ||
        !supplied?.value ||
        !isNodeOfType(supplied.value, "JSXExpressionContainer") ||
        !isNodeOfType(supplied.value.expression, "Identifier")
      )
        return null;
      const handler = resolveExactLocalFunction(supplied.value.expression, context.scopes);
      if (
        !handler ||
        !isFunctionLike(handler) ||
        !handler.async ||
        handler.generator ||
        findEnclosingFunction(handler) !== owner ||
        !hasDirectFunctionBinding(handler, context.scopes) ||
        !hasClosedHandlerStateSetters({ ...options, handler, owner }) ||
        (selectedHandler && selectedHandler !== handler)
      )
        return null;
      selectedHandler = handler;
      suppliedAttributes.add(supplied);
    }
  }
  if (!selectedHandler) return null;
  for (const symbol of getFunctionBindingSymbols(selectedHandler, context.scopes)) {
    if (
      !symbol.references.every((reference) => {
        const direct = findTransparentExpressionRoot(reference.identifier);
        const supplied = getDirectAttribute(direct);
        return supplied && suppliedAttributes.has(supplied);
      })
    )
      return null;
  }
  return selectedHandler;
};
