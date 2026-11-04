import {
  CUSTOM_SPLIT_CALL_ARGUMENT_COUNT,
  CUSTOM_SPLIT_INPUT_PARAMETER_COUNT,
  CUSTOM_SPLIT_METHOD_PROPERTY_COUNT,
  CUSTOM_SPLIT_OBJECT_ASSIGN_ARGUMENT_COUNT,
  CUSTOM_SPLIT_RECORD_PAIR_COUNT,
  FUNCTION_RESOLUTION_MAX_DEPTH,
} from "../constants/thresholds.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getNodeEndIndex } from "./get-node-end-index.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getSymbolTypeAnnotation } from "./get-symbol-type-annotation.js";
import { getStringLiteralAttributeValue } from "./get-string-literal-attribute-value.js";
import { hasCompleteGlobalReferences } from "./has-complete-global-references.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasGlobalNamespaceMutation } from "./has-global-namespace-mutation.js";
import { hasOpaqueIntrinsicAccess } from "./has-opaque-intrinsic-access.js";
import { isComponentFunction } from "./is-component-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { isUnconditionalComponentRenderResult } from "./is-unconditional-component-render-result.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface LiteralSplitInputRecord {
  readonly recordId: string;
  readonly defaultValue: string;
  readonly inputType: string | null;
}

const SPLIT_PROVIDER_NAMESPACE_NAMES = ["Object", "Symbol", "String", "RegExp", "Array"];
const SPLIT_PROVIDER_GLOBAL_NAMES = new Set([
  ...SPLIT_PROVIDER_NAMESPACE_NAMES,
  "globalThis",
  "window",
  "self",
  "global",
  "Reflect",
]);
const INPUT_RECORD_ATTRIBUTE_NAMES = new Set(["name", "data-record-id", "defaultValue", "type"]);

const hasPrivateReferences = (
  symbol: SymbolDescriptor,
  usageIdentifier: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  allowedParameter: SymbolDescriptor | null = null,
  visitedSymbols: Set<SymbolDescriptor> = new Set(),
): boolean => {
  if (visitedSymbols.has(symbol) || visitedSymbols.size >= FUNCTION_RESOLUTION_MAX_DEPTH)
    return false;
  visitedSymbols.add(symbol);
  if (
    (symbol !== allowedParameter && !getDirectConstInitializer(symbol)) ||
    !hasCompleteSymbolReferences(symbol, program, scopes) ||
    !isSymbolReadOnly(symbol) ||
    isNodeOfType(symbol.declarationNode.parent?.parent, "ExportNamedDeclaration")
  )
    return false;
  return symbol.references.every((reference) => {
    const identifier = reference.identifier;
    if (
      symbol !== allowedParameter &&
      findEnclosingFunction(identifier) === findEnclosingFunction(symbol.declarationNode) &&
      (getNodeEndIndex(symbol.declarationNode) < 0 ||
        getNodeStartIndex(identifier) < getNodeEndIndex(symbol.declarationNode))
    )
      return false;
    if (identifier === usageIdentifier) return true;
    const expressionRoot = findTransparentExpressionRoot(identifier);
    const declaration = expressionRoot.parent;
    if (
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.init !== expressionRoot ||
      !isNodeOfType(declaration.id, "Identifier")
    )
      return false;
    const alias = scopes.symbolFor(declaration.id);
    return Boolean(
      alias &&
      hasPrivateReferences(
        alias,
        usageIdentifier,
        program,
        scopes,
        allowedParameter,
        visitedSymbols,
      ),
    );
  });
};

const resolvePrivateCarrier = (
  expression: EsTreeNode,
  usageIdentifier: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols: Set<SymbolDescriptor> = new Set(),
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return candidate;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbols.has(symbol) || visitedSymbols.size >= FUNCTION_RESOLUTION_MAX_DEPTH)
    return null;
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer || !hasPrivateReferences(symbol, usageIdentifier, program, scopes)) return null;
  visitedSymbols.add(symbol);
  return resolvePrivateCarrier(initializer, usageIdentifier, program, scopes, visitedSymbols);
};

const isDirectComponentProp = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "parameter") return false;
  const annotation = getSymbolTypeAnnotation(symbol);
  const typeMember = annotation?.parent?.parent;
  if (
    !isNodeOfType(annotation, "TSStringKeyword") ||
    !isNodeOfType(typeMember, "TSPropertySignature") ||
    typeMember.optional ||
    typeMember.computed
  )
    return false;
  const owner = findEnclosingFunction(symbol.bindingIdentifier);
  if (
    !owner ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    owner.typeParameters ||
    !isComponentFunction(owner) ||
    isNodeOfType(findTransparentExpressionRoot(owner).parent, "CallExpression")
  )
    return false;
  const declaration = owner.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    declaration.id.typeAnnotation ||
    !isNodeOfType(declaration.parent?.parent, "ExportNamedDeclaration") ||
    !isNodeOfType(declaration.parent?.parent?.parent, "Program")
  )
    return false;
  const binding = symbol.bindingIdentifier;
  const property = binding.parent;
  const pattern = property?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.value !== binding ||
    !isNodeOfType(pattern, "ObjectPattern")
  )
    return false;
  const [parameter] = owner.params;
  return parameter === pattern;
};

const hasVariablePrimitiveInput = (
  receiver: EsTreeNode,
  owner: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(receiver, "TemplateLiteral") ||
    receiver.expressions.length !== CUSTOM_SPLIT_INPUT_PARAMETER_COUNT ||
    receiver.quasis.some((quasi) => quasi.value.cooked !== "")
  )
    return false;
  const [expression] = receiver.expressions;
  if (!expression) return false;
  const usageIdentifier = stripParenExpression(expression);
  let current = usageIdentifier;
  const visitedSymbols = new Set<SymbolDescriptor>();
  while (isNodeOfType(current, "Identifier")) {
    const symbol = scopes.symbolFor(current);
    if (
      !symbol ||
      visitedSymbols.has(symbol) ||
      visitedSymbols.size >= FUNCTION_RESOLUTION_MAX_DEPTH
    )
      return false;
    visitedSymbols.add(symbol);
    if (isDirectComponentProp(symbol))
      return (
        findEnclosingFunction(symbol.bindingIdentifier) === owner &&
        hasPrivateReferences(symbol, usageIdentifier, program, scopes, symbol)
      );
    const initializer = getDirectConstInitializer(symbol);
    if (
      !initializer ||
      !isSymbolReadOnly(symbol) ||
      !hasCompleteSymbolReferences(symbol, program, scopes)
    )
      return false;
    current = stripParenExpression(initializer);
  }
  return false;
};

const getAssignedProtocolObject = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.arguments.length !== CUSTOM_SPLIT_OBJECT_ASSIGN_ARGUMENT_COUNT
  )
    return null;
  const callee = stripParenExpression(expression.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticPropertyName(callee) !== "assign" ||
    !isProvenUnmodifiedGlobalNamespaceReference(callee.object, "Object", scopes, undefined, true)
  )
    return null;
  const [target, source] = expression.arguments;
  if (!target || !source) return null;
  const initialTarget = stripParenExpression(target);
  if (!isNodeOfType(initialTarget, "Literal") || !("regex" in initialTarget && initialTarget.regex))
    return null;
  const methods = stripParenExpression(source);
  return isNodeOfType(methods, "ObjectExpression") ? methods : null;
};

const getSplitProtocolMethod = (methods: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode | null => {
  if (
    !isNodeOfType(methods, "ObjectExpression") ||
    methods.properties.length !== CUSTOM_SPLIT_METHOD_PROPERTY_COUNT
  )
    return null;
  const [property] = methods.properties;
  if (!property || !isNodeOfType(property, "Property") || property.kind !== "init") return null;
  const key = stripParenExpression(property.key);
  if (
    !property.computed ||
    !isNodeOfType(key, "MemberExpression") ||
    getStaticPropertyName(key) !== "split" ||
    !isProvenUnmodifiedGlobalNamespaceReference(key.object, "Symbol", scopes, undefined, true)
  )
    return null;
  const method = stripParenExpression(property.value);
  return isFunctionLike(method) &&
    !method.async &&
    !method.generator &&
    method.params.length === CUSTOM_SPLIT_INPUT_PARAMETER_COUNT &&
    method.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
    ? method
    : null;
};

const getInputRecord = (expression: EsTreeNode): LiteralSplitInputRecord | null => {
  const candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "JSXElement") ||
    !isNodeOfType(candidate.openingElement.name, "JSXIdentifier") ||
    candidate.openingElement.name.name !== "input" ||
    candidate.children.length !== 0 ||
    candidate.openingElement.attributes.length > INPUT_RECORD_ATTRIBUTE_NAMES.size
  )
    return null;
  const values = new Map<string, string>();
  for (const attribute of candidate.openingElement.attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      !INPUT_RECORD_ATTRIBUTE_NAMES.has(attribute.name.name) ||
      values.has(attribute.name.name)
    )
      return null;
    const value = getStringLiteralAttributeValue(attribute);
    if (value === null) return null;
    values.set(attribute.name.name, value);
  }
  const recordId = values.get("data-record-id");
  const defaultValue = values.get("defaultValue");
  const inputType = values.get("type") ?? null;
  return recordId &&
    values.get("name") === recordId &&
    defaultValue !== undefined &&
    (inputType === null || inputType === "text")
    ? { recordId, defaultValue, inputType }
    : null;
};

const getInputRecords = (expression: EsTreeNode): LiteralSplitInputRecord[] | null => {
  const candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "ArrayExpression") ||
    candidate.elements.length !== CUSTOM_SPLIT_RECORD_PAIR_COUNT
  )
    return null;
  const records: LiteralSplitInputRecord[] = [];
  for (const element of candidate.elements) {
    const record = element ? getInputRecord(element) : null;
    if (!record) return null;
    records.push(record);
  }
  return records;
};

const isSameInputRecord = (
  left: LiteralSplitInputRecord,
  right: LiteralSplitInputRecord,
): boolean =>
  left.recordId === right.recordId &&
  left.defaultValue === right.defaultValue &&
  left.inputType === right.inputType;

const returnsReversedInputRecords = (
  method: EsTreeNode | null,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!method || !isFunctionLike(method)) return false;
  const [parameter] = method.params;
  const parameterSymbol = parameter ? scopes.symbolFor(parameter) : null;
  const returned = getSingleReturnExpression(method);
  if (
    !parameterSymbol ||
    !isSymbolReadOnly(parameterSymbol) ||
    !hasCompleteSymbolReferences(parameterSymbol, program, scopes) ||
    !returned
  )
    return false;
  const output = stripParenExpression(returned);
  if (!isNodeOfType(output, "ConditionalExpression")) return false;
  const condition = stripParenExpression(output.test);
  if (
    !isNodeOfType(condition, "BinaryExpression") ||
    condition.operator !== "===" ||
    !isNodeOfType(condition.left, "Identifier") ||
    scopes.symbolFor(condition.left) !== parameterSymbol ||
    !isNodeOfType(condition.right, "Literal") ||
    typeof condition.right.value !== "string"
  )
    return false;
  const consequent = getInputRecords(output.consequent);
  const alternate = getInputRecords(output.alternate);
  if (!consequent || !alternate) return false;
  const [first, second] = consequent;
  const [reverseFirst, reverseSecond] = alternate;
  return Boolean(
    first &&
    second &&
    reverseFirst &&
    reverseSecond &&
    first.recordId !== second.recordId &&
    first.defaultValue !== second.defaultValue &&
    isSameInputRecord(first, reverseSecond) &&
    isSameInputRecord(second, reverseFirst),
  );
};

const isSingleRenderedSplitMap = (
  splitCall: EsTreeNode,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const splitRoot = findTransparentExpressionRoot(splitCall);
  const member = splitRoot.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== splitRoot ||
    getStaticPropertyName(member) !== "map"
  )
    return false;
  const memberRoot = findTransparentExpressionRoot(member);
  const iterator = memberRoot.parent;
  if (!isNodeOfType(iterator, "CallExpression") || iterator.callee !== memberRoot) return false;
  const returned = getSingleReturnExpression(owner);
  if (!returned || !isUnconditionalComponentRenderResult(returned, scopes)) return false;
  const result = stripParenExpression(returned);
  if (result === iterator) return true;
  if (!isNodeOfType(result, "JSXFragment")) return false;
  let hasRenderedSplitMap = false;
  for (const child of result.children) {
    if (isNodeOfType(child, "JSXText") && child.value.trim() === "") continue;
    if (
      hasRenderedSplitMap ||
      !isNodeOfType(child, "JSXExpressionContainer") ||
      stripParenExpression(child.expression) !== iterator
    )
      return false;
    hasRenderedSplitMap = true;
  }
  return hasRenderedSplitMap;
};

export const hasReorderedCustomSplitOutput = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "CallExpression") ||
    candidate.arguments.length !== CUSTOM_SPLIT_CALL_ARGUMENT_COUNT
  )
    return false;
  const callee = stripParenExpression(candidate.callee);
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "split")
    return false;
  const program = findProgramRoot(candidate);
  const owner = findEnclosingFunction(candidate);
  if (
    !program ||
    !owner ||
    !isSingleRenderedSplitMap(candidate, owner, scopes) ||
    hasOpaqueIntrinsicAccess(program, scopes, {
      protectedGlobalNames: SPLIT_PROVIDER_GLOBAL_NAMES,
    }) ||
    !hasCompleteGlobalReferences(SPLIT_PROVIDER_GLOBAL_NAMES, program, scopes) ||
    SPLIT_PROVIDER_NAMESPACE_NAMES.some((namespace) =>
      hasGlobalNamespaceMutation(namespace, scopes, undefined, true),
    )
  )
    return false;
  const receiver = resolvePrivateCarrier(
    callee.object,
    stripParenExpression(callee.object),
    program,
    scopes,
  );
  if (!receiver || !hasVariablePrimitiveInput(receiver, owner, program, scopes)) return false;
  const [separator] = candidate.arguments;
  if (!separator || isNodeOfType(separator, "SpreadElement")) return false;
  const carrier = resolvePrivateCarrier(
    separator,
    stripParenExpression(separator),
    program,
    scopes,
  );
  if (!carrier) return false;
  const methods = isNodeOfType(carrier, "ObjectExpression")
    ? carrier
    : getAssignedProtocolObject(carrier, scopes);
  return Boolean(
    methods &&
    returnsReversedInputRecords(getSplitProtocolMethod(methods, scopes), program, scopes),
  );
};
