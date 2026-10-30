import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { STATELESS_HTML_LEAF_TAGS } from "../../../utils/jsx-stateless-leaf.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  PRIMITIVE_SPLIT_CHILD_ARGUMENT_COUNT,
  PRIMITIVE_SPLIT_CHILD_CALLBACK_PARAMETER_COUNT,
  PRIMITIVE_SPLIT_CHILD_DICTIONARY_MINIMUM_ENTRIES,
  PRIMITIVE_SPLIT_CHILD_PROVIDER_EXPOSURE_PROPERTIES,
  PRIMITIVE_SPLIT_CHILD_FIRST_INDEX,
  PRIMITIVE_SPLIT_CHILD_RANGE_END_INDEX,
  PRIMITIVE_SPLIT_CHILD_RUNTIME_TYPESCRIPT_NODES,
  PRIMITIVE_SPLIT_CHILD_UNSUPPORTED_GLOBAL_NAMES,
} from "./constants.js";

const readonlyBindings = new WeakMap<SymbolDescriptor, boolean>();
const stringParameters = new WeakMap<SymbolDescriptor, boolean>();
const primitiveDictionaries = new WeakMap<SymbolDescriptor, boolean>();
const unsupportedProviders = new WeakMap<ScopeAnalysis, boolean>();
const unsupportedTextRows = new WeakMap<EsTreeNode, boolean>();

const isReadonlyBinding = (symbol: SymbolDescriptor): boolean => {
  const cached = readonlyBindings.get(symbol);
  if (cached !== undefined) return cached;
  const readonly = symbol.references.every(
    (reference) =>
      isTypeScriptTypePosition(reference.identifier) ||
      (reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier)),
  );
  readonlyBindings.set(symbol, readonly);
  return readonly;
};

const isReadonlyStringParameter = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "parameter" || !isReadonlyBinding(symbol)) return false;
  const identifier = symbol.bindingIdentifier;
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (
    isNodeOfType(identifier.typeAnnotation, "TSTypeAnnotation") &&
    isNodeOfType(identifier.typeAnnotation.typeAnnotation, "TSStringKeyword")
  )
    return true;
  const property = identifier.parent;
  const pattern = property?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.value !== identifier ||
    !isNodeOfType(pattern, "ObjectPattern") ||
    !isNodeOfType(pattern.typeAnnotation, "TSTypeAnnotation") ||
    !isNodeOfType(pattern.typeAnnotation.typeAnnotation, "TSTypeLiteral")
  )
    return false;
  const propertyName = getStaticKeyName(property.key);
  const declarations = pattern.typeAnnotation.typeAnnotation.members.filter(
    (member) =>
      isNodeOfType(member, "TSPropertySignature") &&
      !member.computed &&
      getStaticKeyName(member.key) === propertyName,
  );
  const declaration = declarations[PRIMITIVE_SPLIT_CHILD_FIRST_INDEX];
  return (
    declarations.length === PRIMITIVE_SPLIT_CHILD_ARGUMENT_COUNT &&
    isNodeOfType(declaration, "TSPropertySignature") &&
    !declaration.optional &&
    isNodeOfType(declaration.typeAnnotation, "TSTypeAnnotation") &&
    isNodeOfType(declaration.typeAnnotation.typeAnnotation, "TSStringKeyword")
  );
};

const hasStringParameterAnnotation = (symbol: SymbolDescriptor): boolean => {
  const cached = stringParameters.get(symbol);
  if (cached !== undefined) return cached;
  const supported = isReadonlyStringParameter(symbol);
  stringParameters.set(symbol, supported);
  return supported;
};

const isDirectLiteralSplit = (expression: EsTreeNode): boolean =>
  isNodeOfType(expression, "CallExpression") &&
  !expression.optional &&
  isNodeOfType(expression.callee, "MemberExpression") &&
  !expression.callee.computed &&
  !expression.callee.optional &&
  isNodeOfType(expression.callee.property, "Identifier") &&
  expression.callee.property.name === "split" &&
  expression.arguments.length === PRIMITIVE_SPLIT_CHILD_ARGUMENT_COUNT &&
  isNodeOfType(expression.arguments[PRIMITIVE_SPLIT_CHILD_FIRST_INDEX], "Literal") &&
  typeof expression.arguments[PRIMITIVE_SPLIT_CHILD_FIRST_INDEX].value === "string";

const isClosedPrimitiveDictionary = (symbol: SymbolDescriptor): boolean => {
  if (!isReadonlyBinding(symbol)) return false;
  const initializer = getDirectConstInitializer(symbol);
  if (
    !isNodeOfType(initializer, "ObjectExpression") ||
    initializer.properties.length < PRIMITIVE_SPLIT_CHILD_DICTIONARY_MINIMUM_ENTRIES ||
    isNodeOfType(symbol.declarationNode.parent?.parent, "ExportNamedDeclaration") ||
    symbol.references.some((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return false;
      const member = reference.identifier.parent;
      return !isNodeOfType(member, "MemberExpression") || member.object !== reference.identifier;
    })
  )
    return false;
  const keys = new Set<string>();
  return initializer.properties.every((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.value, "Literal")
    )
      return false;
    const key = getStaticKeyName(property.key);
    const value = property.value.value;
    if (
      key === null ||
      keys.has(key) ||
      PRIMITIVE_SPLIT_CHILD_PROVIDER_EXPOSURE_PROPERTIES.has(key) ||
      !(
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      )
    )
      return false;
    keys.add(key);
    return true;
  });
};

const isClosedPrimitiveDictionaryAccess = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "MemberExpression")) return false;
  const receiver = stripParenExpression(node.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  if (!symbol) return false;
  const cached = primitiveDictionaries.get(symbol);
  if (cached !== undefined) return cached;
  const supported = isClosedPrimitiveDictionary(symbol);
  primitiveDictionaries.set(symbol, supported);
  return supported;
};

const hasUnsupportedPrimitiveProvider = (scopes: ScopeAnalysis): boolean => {
  const cached = unsupportedProviders.get(scopes);
  if (cached !== undefined) return cached;
  let unsupported = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (unsupported) return false;
    if (
      ("declare" in node && node.declare === true) ||
      node.type === "WithStatement" ||
      PRIMITIVE_SPLIT_CHILD_RUNTIME_TYPESCRIPT_NODES.has(node.type)
    ) {
      unsupported = true;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(node, scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (
        (propertyName !== null &&
          PRIMITIVE_SPLIT_CHILD_PROVIDER_EXPOSURE_PROPERTIES.has(propertyName)) ||
        (node.computed && propertyName === null && !isClosedPrimitiveDictionaryAccess(node, scopes))
      ) {
        unsupported = true;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.referenceFor(node)) return undefined;
    const symbol = scopes.symbolFor(node);
    if (
      (symbol && isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol)) ||
      (PRIMITIVE_SPLIT_CHILD_UNSUPPORTED_GLOBAL_NAMES.has(node.name) &&
        scopes.isGlobalReference(node))
    ) {
      unsupported = true;
      return false;
    }
    return undefined;
  });
  unsupportedProviders.set(scopes, unsupported);
  return unsupported;
};

const hasUnsupportedTextRow = (jsxElement: EsTreeNode): boolean => {
  const cached = unsupportedTextRows.get(jsxElement);
  if (cached !== undefined) return cached;
  let unsupported = false;
  walkAst(jsxElement, (node) => {
    if (unsupported) return false;
    if (
      isNodeOfType(node, "JSXSpreadAttribute") ||
      (isNodeOfType(node, "JSXAttribute") &&
        isNodeOfType(node.name, "JSXIdentifier") &&
        (node.name.name === "ref" || node.name.name.startsWith("on"))) ||
      (isNodeOfType(node, "JSXOpeningElement") &&
        (!isNodeOfType(node.name, "JSXIdentifier") ||
          !STATELESS_HTML_LEAF_TAGS.has(node.name.name)))
    ) {
      unsupported = true;
      return false;
    }
    return undefined;
  });
  unsupportedTextRows.set(jsxElement, unsupported);
  return unsupported;
};

export const isPrimitiveStringTokenSplitChild = (
  expression: EsTreeNode,
  iteratorCall: EsTreeNode,
  jsxElement: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(expression, "MemberExpression") ||
    !expression.computed ||
    expression.optional ||
    !isNodeOfType(expression.property, "Literal") ||
    typeof expression.property.value !== "number" ||
    !Number.isInteger(expression.property.value) ||
    expression.property.value < PRIMITIVE_SPLIT_CHILD_FIRST_INDEX ||
    !isDirectLiteralSplit(expression.object) ||
    !isNodeOfType(expression.object, "CallExpression") ||
    !isNodeOfType(expression.object.callee, "MemberExpression")
  )
    return false;
  const token = stripParenExpression(expression.object.callee.object);
  if (!isNodeOfType(token, "Identifier")) return false;
  if (
    !isNodeOfType(iteratorCall, "CallExpression") ||
    iteratorCall.optional ||
    iteratorCall.arguments.length !== PRIMITIVE_SPLIT_CHILD_ARGUMENT_COUNT ||
    !isNodeOfType(iteratorCall.callee, "MemberExpression") ||
    iteratorCall.callee.computed ||
    iteratorCall.callee.optional ||
    !isNodeOfType(iteratorCall.callee.property, "Identifier") ||
    iteratorCall.callee.property.name !== "map"
  )
    return false;
  const callback = iteratorCall.arguments[PRIMITIVE_SPLIT_CHILD_FIRST_INDEX];
  if (
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression")) ||
    callback.async ||
    callback.params.length !== PRIMITIVE_SPLIT_CHILD_CALLBACK_PARAMETER_COUNT ||
    (isNodeOfType(callback, "FunctionExpression") && (callback.generator || callback.id)) ||
    !isNodeOfType(callback.params[PRIMITIVE_SPLIT_CHILD_FIRST_INDEX], "Identifier")
  )
    return false;
  const tokenSymbol = scopes.symbolFor(token);
  if (
    !tokenSymbol ||
    tokenSymbol.kind !== "parameter" ||
    tokenSymbol.bindingIdentifier !== callback.params[PRIMITIVE_SPLIT_CHILD_FIRST_INDEX] ||
    !isReadonlyBinding(tokenSymbol)
  )
    return false;
  let sourceSplit = stripParenExpression(iteratorCall.callee.object);
  if (isNodeOfType(sourceSplit, "Identifier")) {
    const partsSymbol = scopes.symbolFor(sourceSplit);
    if (!partsSymbol || !isReadonlyBinding(partsSymbol)) return false;
    const initializer = getDirectConstInitializer(partsSymbol);
    if (
      !initializer ||
      !partsSymbol.declarationNode.range ||
      !iteratorCall.range ||
      partsSymbol.declarationNode.range[PRIMITIVE_SPLIT_CHILD_RANGE_END_INDEX] >
        iteratorCall.range[PRIMITIVE_SPLIT_CHILD_FIRST_INDEX] ||
      partsSymbol.references.some(
        (reference) =>
          !isTypeScriptTypePosition(reference.identifier) && reference.identifier !== sourceSplit,
      )
    )
      return false;
    sourceSplit = stripParenExpression(initializer);
  }
  if (
    !isDirectLiteralSplit(sourceSplit) ||
    !isNodeOfType(sourceSplit, "CallExpression") ||
    !isNodeOfType(sourceSplit.callee, "MemberExpression")
  )
    return false;
  const source = stripParenExpression(sourceSplit.callee.object);
  const sourceSymbol = isNodeOfType(source, "Identifier") ? scopes.symbolFor(source) : null;
  if (
    !(isNodeOfType(source, "Literal") && typeof source.value === "string") &&
    !(sourceSymbol && hasStringParameterAnnotation(sourceSymbol))
  )
    return false;
  return !hasUnsupportedTextRow(jsxElement) && !hasUnsupportedPrimitiveProvider(scopes);
};
