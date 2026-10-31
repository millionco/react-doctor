import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import {
  getReactDoctorStringArraySetting,
  getReactDoctorStringSetting,
} from "../../../utils/get-react-doctor-setting.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  LOCAL_TEXT_EMPTY_NODE_COUNT,
  LOCAL_TEXT_MAP_PARAMETER_COUNT,
  LOCAL_TEXT_MAX_AST_NODES,
  LOCAL_TEXT_MAX_SOURCE_CHARACTERS,
  LOCAL_TEXT_MODULE_STATEMENT_COUNT,
  LOCAL_TEXT_REQUIRED_CAPABILITIES,
  LOCAL_TEXT_SINGLE_NODE_COUNT,
  LOCAL_TEXT_SUPPORTED_FRAMEWORKS,
  LOCAL_TEXT_UNSUPPORTED_CAPABILITIES,
  LOCAL_TEXT_UNSUPPORTED_JSX_DIRECTIVE_PATTERN,
} from "./local-text-wrapper/constants.js";

interface ClosedLocalTextWrapperKeyInput {
  readonly attribute: EsTreeNodeOfType<"JSXAttribute">;
  readonly context: RuleContext;
}

interface ClosedLocalTextWrapperProof {
  readonly source: string;
  readonly attribute: EsTreeNode | null;
}

const proofsByScopes = new WeakMap<ScopeAnalysis, ClosedLocalTextWrapperProof>();

const hasSupportedProfile = (context: RuleContext): boolean => {
  const profile = Object.getOwnPropertyDescriptor(context.settings ?? {}, "react-doctor")?.value;
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) return false;
  const rawCapabilities = Object.getOwnPropertyDescriptor(profile, "capabilities")?.value;
  const framework = getReactDoctorStringSetting(context.settings, "framework");
  if (
    !framework ||
    !LOCAL_TEXT_SUPPORTED_FRAMEWORKS.has(framework) ||
    !Array.isArray(rawCapabilities) ||
    !rawCapabilities.every((capability) => typeof capability === "string" && capability.length > 0)
  )
    return false;
  const capabilities = new Set(getReactDoctorStringArraySetting(context.settings, "capabilities"));
  return (
    capabilities.size === rawCapabilities.length &&
    capabilities.has(framework) &&
    [...LOCAL_TEXT_REQUIRED_CAPABILITIES].every((capability) => capabilities.has(capability)) &&
    [...LOCAL_TEXT_UNSUPPORTED_CAPABILITIES].every((capability) => !capabilities.has(capability))
  );
};

const hasExactReads = (
  symbol: SymbolDescriptor | null,
  identifiers: readonly EsTreeNode[],
): boolean =>
  Boolean(
    symbol &&
    symbol.references.length === identifiers.length &&
    symbol.references.every(
      (reference) => reference.flag === "read" && identifiers.includes(reference.identifier),
    ),
  );

const readConstArrow = (
  declaration: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | null => {
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== LOCAL_TEXT_SINGLE_NODE_COUNT
  )
    return null;
  const [declarator] = declaration.declarations;
  if (!declarator || !isNodeOfType(declarator.id, "Identifier")) return null;
  const symbol = scopes.symbolFor(declarator.id);
  const initializer = symbol && getDirectConstInitializer(symbol);
  return isNodeOfType(initializer, "ArrowFunctionExpression") &&
    !initializer.async &&
    !initializer.generator
    ? initializer
    : null;
};

const readSingleIdentifierChild = (element: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(element, "JSXElement")) return null;
  const children = element.children.filter(
    (child) => !isNodeOfType(child, "JSXText") || child.value.trim() !== "",
  );
  const [child] = children;
  return children.length === LOCAL_TEXT_SINGLE_NODE_COUNT &&
    isNodeOfType(child, "JSXExpressionContainer") &&
    isNodeOfType(child.expression, "Identifier")
    ? child.expression
    : null;
};

const readClosedModuleKey = (context: RuleContext): EsTreeNode | null => {
  const { scopes } = context;
  const program = scopes.rootScope.node;
  if (
    !isNodeOfType(program, "Program") ||
    program.body.length !== LOCAL_TEXT_MODULE_STATEMENT_COUNT
  )
    return null;
  let nodeCount = LOCAL_TEXT_EMPTY_NODE_COUNT;
  let supported = true;
  walkAst(program, (node) => {
    nodeCount += LOCAL_TEXT_SINGLE_NODE_COUNT;
    if (
      nodeCount > LOCAL_TEXT_MAX_AST_NODES ||
      node.type.startsWith("TS") ||
      ("typeAnnotation" in node && Boolean(node.typeAnnotation)) ||
      ("typeParameters" in node && Boolean(node.typeParameters)) ||
      ("typeArguments" in node && Boolean(node.typeArguments)) ||
      ("returnType" in node && Boolean(node.returnType)) ||
      ("optional" in node && node.optional === true) ||
      ("declare" in node && node.declare === true)
    )
      supported = false;
    return supported;
  });
  if (!supported) return null;
  const [reactImport, wrapperDeclaration, renderExport] = program.body;
  if (
    !isNodeOfType(reactImport, "ImportDeclaration") ||
    reactImport.importKind === "type" ||
    reactImport.specifiers.length !== LOCAL_TEXT_SINGLE_NODE_COUNT ||
    reactImport.attributes.length !== LOCAL_TEXT_EMPTY_NODE_COUNT ||
    ("phase" in reactImport && reactImport.phase !== null && reactImport.phase !== undefined) ||
    !isNodeOfType(renderExport, "ExportNamedDeclaration") ||
    renderExport.exportKind === "type" ||
    renderExport.specifiers.length !== LOCAL_TEXT_EMPTY_NODE_COUNT ||
    renderExport.source
  )
    return null;
  const [reactSpecifier] = reactImport.specifiers;
  if (
    !isNodeOfType(reactSpecifier, "ImportDefaultSpecifier") ||
    reactSpecifier.local.name !== "React"
  )
    return null;
  const reactSymbol = scopes.symbolFor(reactSpecifier.local);
  if (
    !reactSymbol ||
    getValueImportSource(reactSymbol) !== "react" ||
    !hasExactReads(reactSymbol, [])
  )
    return null;
  const wrapper = readConstArrow(wrapperDeclaration, scopes);
  const render = readConstArrow(renderExport.declaration, scopes);
  if (
    !wrapper ||
    !render ||
    wrapper.params.length !== LOCAL_TEXT_SINGLE_NODE_COUNT ||
    render.params.length !== LOCAL_TEXT_EMPTY_NODE_COUNT
  )
    return null;
  const wrapperDeclarator = wrapper.parent;
  const renderDeclarator = render.parent;
  if (
    !isNodeOfType(wrapperDeclarator, "VariableDeclarator") ||
    !isNodeOfType(wrapperDeclarator.id, "Identifier") ||
    !isNodeOfType(renderDeclarator, "VariableDeclarator") ||
    !isNodeOfType(renderDeclarator.id, "Identifier") ||
    new Set([reactSpecifier.local.name, wrapperDeclarator.id.name, renderDeclarator.id.name])
      .size !== LOCAL_TEXT_MODULE_STATEMENT_COUNT ||
    !hasExactReads(scopes.symbolFor(renderDeclarator.id), [])
  )
    return null;
  const [parameter] = wrapper.params;
  if (
    !isNodeOfType(parameter, "ObjectPattern") ||
    parameter.properties.length !== LOCAL_TEXT_SINGLE_NODE_COUNT
  )
    return null;
  const [property] = parameter.properties;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.method ||
    property.kind !== "init" ||
    !property.shorthand ||
    !isNodeOfType(property.key, "Identifier") ||
    property.key.name !== "children" ||
    !isNodeOfType(property.value, "Identifier") ||
    property.value.name !== "children"
  )
    return null;
  const returnedSpan = getSingleReturnExpression(wrapper);
  const forwardedChild = returnedSpan && readSingleIdentifierChild(returnedSpan);
  if (
    !isNodeOfType(returnedSpan, "JSXElement") ||
    !isNodeOfType(returnedSpan.openingElement.name, "JSXIdentifier") ||
    returnedSpan.openingElement.name.name !== "span" ||
    returnedSpan.openingElement.attributes.length !== LOCAL_TEXT_EMPTY_NODE_COUNT ||
    !returnedSpan.closingElement ||
    !isNodeOfType(returnedSpan.closingElement.name, "JSXIdentifier") ||
    returnedSpan.closingElement.name.name !== "span" ||
    !forwardedChild ||
    scopes.symbolFor(forwardedChild) !== scopes.symbolFor(property.value) ||
    !hasExactReads(scopes.symbolFor(property.value), [forwardedChild])
  )
    return null;
  const iteration = getSingleReturnExpression(render);
  if (
    !isNodeOfType(iteration, "CallExpression") ||
    iteration.optional ||
    iteration.arguments.length !== LOCAL_TEXT_SINGLE_NODE_COUNT ||
    !isNodeOfType(iteration.callee, "MemberExpression") ||
    iteration.callee.computed ||
    iteration.callee.optional ||
    !isNodeOfType(iteration.callee.property, "Identifier") ||
    iteration.callee.property.name !== "map"
  )
    return null;
  const split = iteration.callee.object;
  const [callback] = iteration.arguments;
  const [separator] = isNodeOfType(split, "CallExpression") ? split.arguments : [];
  if (
    !isNodeOfType(split, "CallExpression") ||
    split.optional ||
    split.arguments.length !== LOCAL_TEXT_SINGLE_NODE_COUNT ||
    !isNodeOfType(split.callee, "MemberExpression") ||
    split.callee.computed ||
    split.callee.optional ||
    !isNodeOfType(split.callee.property, "Identifier") ||
    split.callee.property.name !== "split" ||
    !isNodeOfType(split.callee.object, "Literal") ||
    typeof split.callee.object.value !== "string" ||
    !isNodeOfType(separator, "Literal") ||
    typeof separator.value !== "string" ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.generator ||
    callback.params.length !== LOCAL_TEXT_MAP_PARAMETER_COUNT
  )
    return null;
  const [item, index] = callback.params;
  if (
    !isNodeOfType(item, "Identifier") ||
    !isNodeOfType(index, "Identifier") ||
    item.name === index.name ||
    item.name === reactSpecifier.local.name ||
    index.name === reactSpecifier.local.name
  )
    return null;
  const selectedElement = getSingleReturnExpression(callback);
  const itemChild = selectedElement && readSingleIdentifierChild(selectedElement);
  if (
    !isNodeOfType(selectedElement, "JSXElement") ||
    !isNodeOfType(selectedElement.openingElement.name, "JSXIdentifier") ||
    !selectedElement.closingElement ||
    !isNodeOfType(selectedElement.closingElement.name, "JSXIdentifier") ||
    selectedElement.openingElement.attributes.length !== LOCAL_TEXT_SINGLE_NODE_COUNT ||
    !itemChild ||
    scopes.symbolFor(itemChild) !== scopes.symbolFor(item) ||
    !hasExactReads(scopes.symbolFor(item), [itemChild])
  )
    return null;
  const wrapperSymbol = scopes.symbolFor(wrapperDeclarator.id);
  const wrapperReferences = [
    selectedElement.openingElement.name,
    selectedElement.closingElement.name,
  ];
  if (
    wrapperReferences.some((identifier) => scopes.symbolFor(identifier) !== wrapperSymbol) ||
    !hasExactReads(wrapperSymbol, wrapperReferences)
  )
    return null;
  const [attribute] = selectedElement.openingElement.attributes;
  return isNodeOfType(attribute, "JSXAttribute") &&
    isNodeOfType(attribute.name, "JSXIdentifier") &&
    attribute.name.name === "key" &&
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isNodeOfType(attribute.value.expression, "Identifier") &&
    scopes.symbolFor(attribute.value.expression) === scopes.symbolFor(index) &&
    hasExactReads(scopes.symbolFor(index), [attribute.value.expression])
    ? attribute
    : null;
};

export const isClosedLocalTextWrapperKey = ({
  attribute,
  context,
}: ClosedLocalTextWrapperKeyInput): boolean => {
  try {
    if (!hasSupportedProfile(context)) return false;
    const source = context.sourceCode?.getText?.();
    if (typeof source !== "string") return false;
    const previous = proofsByScopes.get(context.scopes);
    if (previous) {
      if (previous.source === source) return previous.attribute === attribute;
      proofsByScopes.set(context.scopes, { source, attribute: null });
      return false;
    }
    const selectedAttribute =
      source.length <= LOCAL_TEXT_MAX_SOURCE_CHARACTERS &&
      !LOCAL_TEXT_UNSUPPORTED_JSX_DIRECTIVE_PATTERN.test(source)
        ? readClosedModuleKey(context)
        : null;
    proofsByScopes.set(context.scopes, { source, attribute: selectedAttribute });
    return selectedAttribute === attribute;
  } catch {
    return false;
  }
};
