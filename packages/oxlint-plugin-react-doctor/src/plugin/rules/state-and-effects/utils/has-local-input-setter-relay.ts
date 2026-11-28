import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { resolveStaticJsxAttribute } from "../../../utils/resolve-static-jsx-attribute.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { statementAlwaysExits } from "../../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const HTML_CONTAINERS = new Set([
  "article",
  "aside",
  "div",
  "fieldset",
  "form",
  "main",
  "section",
  "span",
]);

const RESERVED_JSX_PROPS = new Set(["__self", "__source", "key", "ref"]);

const EDITABLE_INPUT_TYPES = new Set([
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

const getAttributeExpression = (attribute: EsTreeNodeOfType<"JSXAttribute"> | null) => {
  const value = attribute?.value;
  return isNodeOfType(value, "JSXExpressionContainer")
    ? stripParenExpression(value.expression)
    : null;
};

const isAttributeAbsentOrFalse = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  name: string,
  isCaseSensitive = true,
): boolean => {
  const resolution = resolveStaticJsxAttribute(opening.attributes, name, isCaseSensitive);
  return (
    !resolution.isUnknown &&
    (!resolution.isPresent ||
      readStaticBoolean(resolution.expression ?? getAttributeExpression(resolution.attribute)) ===
        false)
  );
};

const hasUnprovenInputAttributes = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  isInput = false,
): boolean =>
  opening.attributes.some((attribute) => {
    if (!isNodeOfType(attribute, "JSXAttribute")) return true;
    const name = getJsxAttributeName(attribute.name);
    if (!name || (isInput && name === "onChange")) return false;
    const normalized = name.toLowerCase();
    return (
      normalized.startsWith("on") ||
      normalized === "style" ||
      normalized === "is" ||
      normalized === "ref" ||
      normalized === "dangerouslysetinnerhtml" ||
      (isInput && (normalized === "children" || (normalized === "type" && name !== "type")))
    );
  });

const isRenderedChild = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  component: EsTreeNode,
): boolean => {
  let element = opening.parent;
  while (isNodeOfType(element, "JSXElement") || isNodeOfType(element, "JSXFragment")) {
    const parent = findTransparentExpressionRoot(element).parent;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return (
        isFunctionLike(component) &&
        parent.parent === component.body &&
        isNodeOfType(component.body, "BlockStatement") &&
        component.body.body.at(-1) === parent &&
        !component.body.body.slice(0, -1).some(statementAlwaysExits)
      );
    }
    if (isFunctionLike(parent)) return parent === component;
    if (isNodeOfType(parent, "JSXElement")) {
      const ancestor = parent.openingElement;
      const name = ancestor.name;
      if (
        !isNodeOfType(name, "JSXIdentifier") ||
        !HTML_CONTAINERS.has(name.name) ||
        !isAttributeAbsentOrFalse(ancestor, "hidden", false) ||
        !isAttributeAbsentOrFalse(ancestor, "inert", false) ||
        hasUnprovenInputAttributes(ancestor) ||
        (name.name === "fieldset" && !isAttributeAbsentOrFalse(ancestor, "disabled", false))
      )
        return false;
    }
    element = parent;
  }
  return false;
};

const getProvider = (name: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  const symbol = context.scopes.symbolFor(name);
  if (
    !symbol?.initializer ||
    (symbol.kind !== "const" && symbol.kind !== "function") ||
    !isNodeOfType(context.scopes.rootScope.node, "Program") ||
    context.scopes.rootScope.node.sourceType !== "module" ||
    !hasCompleteSymbolReferences(symbol, context.scopes.rootScope.node, context.scopes) ||
    symbol.references.some(
      ({ flag, identifier }) =>
        flag !== "read" ||
        !isNodeOfType(identifier, "JSXIdentifier") ||
        (!isNodeOfType(identifier.parent, "JSXOpeningElement") &&
          !isNodeOfType(identifier.parent, "JSXClosingElement")) ||
        identifier.parent.name !== identifier,
    ) ||
    symbol.scope.symbols.filter((entry) => entry.name === symbol.name).length !== 1
  )
    return null;
  const declarationParent =
    symbol.kind === "const" ? symbol.declarationNode.parent?.parent : symbol.declarationNode.parent;
  if (
    isNodeOfType(declarationParent, "ExportNamedDeclaration") ||
    isNodeOfType(declarationParent, "ExportDefaultDeclaration")
  )
    return null;
  const initializer = stripParenExpression(symbol.initializer);
  if (isFunctionLike(initializer)) return initializer;
  if (
    isNodeOfType(initializer, "CallExpression") &&
    !initializer.optional &&
    initializer.arguments.length === 1 &&
    isNodeOfType(initializer.callee, "Identifier") &&
    context.scopes.symbolFor(initializer.callee)?.kind === "import" &&
    isReactApiCall(initializer, "forwardRef", context.scopes)
  ) {
    const [render] = initializer.arguments;
    return isFunctionLike(render) ? render : null;
  }
  return null;
};

const getDirectPropName = (
  expression: EsTreeNode | null,
  parameter: EsTreeNode,
  context: RuleContext,
): string | null => {
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(expression);
  const binding = symbol?.bindingIdentifier;
  if (
    !binding ||
    !isNodeOfType(binding.parent, "Property") ||
    binding.parent.parent !== parameter ||
    symbol.references.some(({ flag }) => flag !== "read")
  )
    return null;
  return getDestructuredBindingPropertyName(binding);
};

const isUnblockedInput = (
  input: EsTreeNodeOfType<"JSXOpeningElement">,
  caller: EsTreeNodeOfType<"JSXOpeningElement">,
  props: EsTreeNode,
  context: RuleContext,
): boolean => {
  return ["disabled", "readOnly", "hidden", "inert"].every((name) => {
    if (
      input.attributes.some(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          getJsxAttributeName(attribute.name) !== name &&
          getJsxAttributeName(attribute.name)?.toLowerCase() === name.toLowerCase(),
      )
    )
      return false;
    if (isAttributeAbsentOrFalse(input, name)) return true;
    const attr = getAuthoritativeJsxAttribute(input.attributes, name);
    const value = getAttributeExpression(attr);
    if (!isNodeOfType(value, "Identifier")) return false;
    const binding = context.scopes.symbolFor(value);
    const defaultValue = binding?.bindingIdentifier.parent;
    if (
      !binding ||
      binding.references.some(({ flag }) => flag !== "read") ||
      !isNodeOfType(defaultValue, "AssignmentPattern") ||
      defaultValue.left !== binding.bindingIdentifier ||
      readStaticBoolean(defaultValue.right) !== false ||
      defaultValue.parent?.parent !== props
    )
      return false;
    const prop = getDestructuredBindingPropertyName(binding.bindingIdentifier);
    return prop !== null && !RESERVED_JSX_PROPS.has(prop) && isAttributeAbsentOrFalse(caller, prop);
  });
};

const getChangeHandlerCall = (handler: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(handler) || handler.async || handler.generator || handler.params.length !== 1)
    return null;
  const body = handler.body;
  if (!isNodeOfType(body, "BlockStatement")) return stripParenExpression(body);
  const [statement] = body.body;
  return body.body.length === 1 && isNodeOfType(statement, "ExpressionStatement")
    ? stripParenExpression(statement.expression)
    : null;
};

export const hasLocalInputSetterRelay = (
  setter: EsTreeNode,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  const forwardedSetter = findTransparentExpressionRoot(setter);
  const container = forwardedSetter.parent;
  const setterAttribute = container?.parent;
  const opening = setterAttribute?.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== forwardedSetter ||
    !isNodeOfType(setterAttribute, "JSXAttribute") ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    !/^[A-Z]/.test(opening.name.name)
  )
    return false;
  const setterName = getJsxAttributeName(setterAttribute.name);
  if (
    !setterName ||
    RESERVED_JSX_PROPS.has(setterName) ||
    getAuthoritativeJsxAttribute(opening.attributes, setterName) !== setterAttribute ||
    !isRenderedChild(opening, component)
  )
    return false;
  const provider = getProvider(opening.name, context);
  if (!isFunctionLike(provider) || provider.async || provider.generator) return false;
  const [props, forwardedRef] = provider.params;
  const rendered = getSingleReturnExpression(provider);
  const input = rendered ? stripParenExpression(rendered) : null;
  if (
    !isNodeOfType(props, "ObjectPattern") ||
    provider.params.length > 2 ||
    (forwardedRef && !isNodeOfType(forwardedRef, "Identifier")) ||
    props.properties.some(
      (property) =>
        !isNodeOfType(property, "Property") ||
        property.computed ||
        (!isNodeOfType(property.value, "Identifier") &&
          (!isNodeOfType(property.value, "AssignmentPattern") ||
            !isNodeOfType(property.value.left, "Identifier") ||
            readStaticBoolean(property.value.right) !== false)),
    ) ||
    !isNodeOfType(input, "JSXElement") ||
    input.children.length !== 0 ||
    !isNodeOfType(input.openingElement.name, "JSXIdentifier") ||
    input.openingElement.name.name !== "input"
  )
    return false;
  const inputOpening = input.openingElement;
  const type = resolveStaticJsxAttribute(inputOpening.attributes, "type");
  const typeValue = type.attribute?.value;
  const explicitTypeNode = getAttributeExpression(type.attribute) ?? type.expression ?? typeValue;
  if (
    hasUnprovenInputAttributes(inputOpening, true) ||
    type.isUnknown ||
    (type.isPresent &&
      (!isNodeOfType(explicitTypeNode, "Literal") ||
        typeof explicitTypeNode.value !== "string" ||
        !EDITABLE_INPUT_TYPES.has(explicitTypeNode.value.toLowerCase()))) ||
    !isUnblockedInput(inputOpening, opening, props, context)
  )
    return false;
  const inputValue = getAuthoritativeJsxAttribute(inputOpening.attributes, "value");
  const valueProp = getDirectPropName(getAttributeExpression(inputValue), props, context);
  if (!valueProp || RESERVED_JSX_PROPS.has(valueProp) || valueProp === setterName) return false;
  const consumedValue = getAttributeExpression(
    getAuthoritativeJsxAttribute(opening.attributes, valueProp),
  );
  const state = resolveReactUseStatePair(setter, context.scopes)?.stateSymbol;
  if (!state || !consumedValue || context.scopes.symbolFor(consumedValue) !== state) return false;

  const handler = getAttributeExpression(
    getAuthoritativeJsxAttribute(inputOpening.attributes, "onChange"),
  );
  if (!handler || !isFunctionLike(handler)) return false;
  const [event] = handler.params;
  const call = getChangeHandlerCall(handler);
  if (
    !isNodeOfType(event, "Identifier") ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 1 ||
    getDirectPropName(stripParenExpression(call.callee), props, context) !== setterName
  )
    return false;
  const [argument] = call.arguments;
  const value = argument ? stripParenExpression(argument) : null;
  if (
    !isNodeOfType(value, "MemberExpression") ||
    value.optional ||
    getStaticPropertyName(value) !== "value"
  ) {
    return false;
  }
  const target = stripParenExpression(value.object);
  const eventSymbol = context.scopes.symbolFor(event);
  return (
    Boolean(eventSymbol) &&
    isNodeOfType(target, "MemberExpression") &&
    !target.optional &&
    getStaticPropertyName(target) === "target" &&
    context.scopes.symbolFor(stripParenExpression(target.object)) ===
      context.scopes.symbolFor(event)
  );
};
