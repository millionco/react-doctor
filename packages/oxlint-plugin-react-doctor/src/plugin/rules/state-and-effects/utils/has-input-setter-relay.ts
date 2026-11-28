import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findExportedValue } from "../../../utils/find-exported-value.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { parseSourceFile } from "../../../utils/parse-source-file.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { resolveUniqueRelativeSourceFile } from "../../../utils/resolve-relative-import-path.js";
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

const hasPassiveAdditionalAttributes = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  provenNames: readonly string[] = [],
): boolean => {
  const names = new Set<string>();
  return opening.attributes.every((attribute) => {
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const name = getJsxAttributeName(attribute.name);
    if (!name || names.has(name)) return false;
    names.add(name);
    return (
      provenNames.includes(name) ||
      attribute.value === null ||
      isNodeOfType(attribute.value, "Literal") ||
      isNodeOfType(getAttributeExpression(attribute), "Literal")
    );
  });
};

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
        !hasPassiveAdditionalAttributes(ancestor) ||
        (name.name === "fieldset" && !isAttributeAbsentOrFalse(ancestor, "disabled", false))
      )
        return false;
    }
    element = parent;
  }
  return false;
};

const hasOnlyJsxReferences = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
  symbol.references.every(
    ({ flag, identifier }) =>
      flag === "read" &&
      isNodeOfType(identifier, "JSXIdentifier") &&
      (isNodeOfType(identifier.parent, "JSXOpeningElement") ||
        isNodeOfType(identifier.parent, "JSXClosingElement")) &&
      identifier.parent.name === identifier,
  ) &&
  symbol.scope.symbols.filter((entry) => entry.name === symbol.name).length === 1;

const getLocalProvider = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): EsTreeNode | null => {
  if (
    !symbol.initializer ||
    (symbol.kind !== "const" && symbol.kind !== "function") ||
    !isNodeOfType(scopes.rootScope.node, "Program") ||
    scopes.rootScope.node.sourceType !== "module" ||
    !hasOnlyJsxReferences(symbol, scopes)
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
    scopes.symbolFor(initializer.callee)?.kind === "import" &&
    isReactApiCall(initializer, "forwardRef", scopes)
  ) {
    const [render] = initializer.arguments;
    return isFunctionLike(render) ? render : null;
  }
  return null;
};

interface InputProvider {
  render: EsTreeNode;
  scopes: ScopeAnalysis;
  isImported: boolean;
}

const providerScopes = new WeakMap<EsTreeNode, ScopeAnalysis>();

const getImportedProvider = (
  symbol: SymbolDescriptor,
  context: RuleContext,
): InputProvider | null => {
  const specifier = symbol.declarationNode;
  const declaration = getImportDeclarationForSymbol(symbol);
  if (
    !context.filename ||
    !declaration ||
    declaration.importKind === "type" ||
    typeof declaration.source.value !== "string" ||
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type" ||
    !hasOnlyJsxReferences(symbol, context.scopes)
  )
    return null;
  const exportName = getImportedName(specifier);
  if (!exportName || exportName === "default") return null;
  const filename = resolveUniqueRelativeSourceFile(context.filename, declaration.source.value);
  if (!filename) return null;
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return null;
  const render = findExportedValue(program, exportName);
  const declarator = render ? findTransparentExpressionRoot(render).parent : null;
  const variableDeclaration = declarator?.parent;
  if (
    !isNodeOfType(render, "ArrowFunctionExpression") ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier") ||
    declarator.id.name !== exportName ||
    !isNodeOfType(variableDeclaration, "VariableDeclaration") ||
    variableDeclaration.kind !== "const" ||
    !isNodeOfType(variableDeclaration.parent, "ExportNamedDeclaration") ||
    variableDeclaration.parent.parent !== program
  )
    return null;
  let scopes = providerScopes.get(program);
  if (!scopes) {
    scopes = analyzeScopes(program);
    providerScopes.set(program, scopes);
  }
  const binding = scopes.symbolFor(declarator.id);
  return binding && hasOnlyJsxReferences(binding, scopes)
    ? { render, scopes, isImported: true }
    : null;
};

const getProvider = (name: EsTreeNode, context: RuleContext): InputProvider | null => {
  const symbol = context.scopes.symbolFor(name);
  if (!symbol) return null;
  if (symbol.kind === "import") return getImportedProvider(symbol, context);
  const render = getLocalProvider(symbol, context.scopes);
  return render ? { render, scopes: context.scopes, isImported: false } : null;
};

const getDirectPropName = (
  expression: EsTreeNode | null,
  parameter: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = scopes.symbolFor(expression);
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
  scopes: ScopeAnalysis,
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
    const binding = scopes.symbolFor(value);
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

export const hasInputSetterRelay = (
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
  if (!provider) return false;
  const { render, scopes: providerScope, isImported } = provider;
  if (!isFunctionLike(render) || render.async || render.generator) return false;
  const [props, forwardedRef] = render.params;
  const rendered = getSingleReturnExpression(render);
  const input = rendered ? stripParenExpression(rendered) : null;
  if (
    !isNodeOfType(props, "ObjectPattern") ||
    render.params.length > (isImported ? 1 : 2) ||
    (forwardedRef && !isNodeOfType(forwardedRef, "Identifier")) ||
    props.properties.some(
      (property) =>
        !isNodeOfType(property, "Property") ||
        property.computed ||
        (!isNodeOfType(property.value, "Identifier") &&
          (isImported ||
            !isNodeOfType(property.value, "AssignmentPattern") ||
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
    !hasPassiveAdditionalAttributes(inputOpening, [
      "disabled",
      "readOnly",
      "hidden",
      "inert",
      "type",
      "value",
      "onChange",
    ]) ||
    type.isUnknown ||
    (type.isPresent &&
      (!isNodeOfType(explicitTypeNode, "Literal") ||
        typeof explicitTypeNode.value !== "string" ||
        !EDITABLE_INPUT_TYPES.has(explicitTypeNode.value.toLowerCase()))) ||
    !isUnblockedInput(inputOpening, opening, props, providerScope)
  )
    return false;
  const inputValue = getAuthoritativeJsxAttribute(inputOpening.attributes, "value");
  const valueProp = getDirectPropName(getAttributeExpression(inputValue), props, providerScope);
  if (!valueProp || RESERVED_JSX_PROPS.has(valueProp) || valueProp === setterName) return false;
  const consumedValue = getAttributeExpression(
    getAuthoritativeJsxAttribute(opening.attributes, valueProp),
  );
  const state = resolveReactUseStatePair(setter, context.scopes)?.stateSymbol;
  if (
    !state ||
    !consumedValue ||
    context.scopes.symbolFor(consumedValue) !== state ||
    !hasPassiveAdditionalAttributes(opening, [valueProp, setterName])
  )
    return false;

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
    getDirectPropName(stripParenExpression(call.callee), props, providerScope) !== setterName
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
  const eventSymbol = providerScope.symbolFor(event);
  return (
    Boolean(eventSymbol) &&
    isNodeOfType(target, "MemberExpression") &&
    !target.optional &&
    getStaticPropertyName(target) === "target" &&
    providerScope.symbolFor(stripParenExpression(target.object)) === eventSymbol
  );
};
