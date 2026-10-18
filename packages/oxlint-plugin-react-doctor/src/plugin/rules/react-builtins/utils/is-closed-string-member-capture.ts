import { BUILTIN_HOOK_NAMES, HOOKS_WITH_DEPS, REACT_HOC_NAMES } from "../../../constants/react.js";
import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

interface ClosedStringMemberCaptureInput {
  readonly reference: ReferenceDescriptor;
  readonly dependencyKey: string;
  readonly callback: EsTreeNode;
  readonly hookCall: EsTreeNode | undefined;
  readonly scopes: ScopeAnalysis;
}

const UNSAFE_STRING_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const captureProviderAdmissionByAnalysis = new WeakMap<ScopeAnalysis, boolean>();
const closedRecordPropertiesByAnalysis = new WeakMap<
  ScopeAnalysis,
  WeakMap<SymbolDescriptor, ReadonlySet<string> | null>
>();

const hasSupportedReactNamespaceReads = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    const member = identifier.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(identifier, "Identifier") ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      member.computed ||
      member.optional
    )
      return false;
    const propertyName = getStaticPropertyName(member);
    const call = member.parent;
    return Boolean(
      propertyName &&
      (BUILTIN_HOOK_NAMES.has(propertyName) ||
        REACT_HOC_NAMES.has(propertyName) ||
        propertyName === "createRef") &&
      isNodeOfType(call, "CallExpression") &&
      call.callee === member &&
      !call.optional,
    );
  });

const hasAdmittedCaptureProviders = (scopes: ScopeAnalysis): boolean => {
  const cachedAdmission = captureProviderAdmissionByAnalysis.get(scopes);
  if (cachedAdmission !== undefined) return cachedAdmission;
  const hasDynamicCode = someAst(scopes.rootScope.node, (node) => {
    if (isNodeOfType(node, "WithStatement")) return true;
    if (!isNodeOfType(node, "CallExpression")) return false;
    const callee = stripParenExpression(node.callee);
    if (isNodeOfType(callee, "Identifier")) return callee.name === "eval";
    if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "eval")
      return false;
    const receiver = stripParenExpression(callee.object);
    return (
      isNodeOfType(receiver, "Identifier") &&
      (receiver.name === "globalThis" || receiver.name === "window")
    );
  });
  const isAdmitted =
    !hasDynamicCode &&
    scopes.rootScope.symbols.every((symbol) => {
      if (getValueImportSource(symbol) !== "react") return true;
      const declaration = symbol.declarationNode;
      return (
        !(
          isNodeOfType(declaration, "ImportDefaultSpecifier") ||
          isNodeOfType(declaration, "ImportNamespaceSpecifier") ||
          getImportedName(declaration) === "default"
        ) || hasSupportedReactNamespaceReads(symbol)
      );
    });
  captureProviderAdmissionByAnalysis.set(scopes, isAdmitted);
  return isAdmitted;
};

const hasValueReactDependencyHook = (
  hookCall: EsTreeNode | undefined,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(hookCall, "CallExpression") || hookCall.optional) return false;
  const [callbackArgument, dependencyArgument] = hookCall.arguments;
  if (callbackArgument !== callback || !isNodeOfType(dependencyArgument, "ArrayExpression"))
    return false;
  const callee = hookCall.callee;
  const identifier = isNodeOfType(callee, "Identifier")
    ? callee
    : isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        !callee.optional &&
        isNodeOfType(callee.object, "Identifier")
      ? callee.object
      : null;
  if (!identifier) return false;
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || getValueImportSource(symbol) !== "react") return false;
  const importedApi = resolveImportedApiReference(callee, scopes);
  return Boolean(
    importedApi?.source === "react" &&
    importedApi.importedName &&
    HOOKS_WITH_DEPS.has(importedApi.importedName),
  );
};

const isClosedOwnStringRead = (
  reference: ReferenceDescriptor,
  symbol: SymbolDescriptor,
  propertyNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const identifier = reference.identifier;
  const member = identifier.parent;
  if (
    reference.flag !== "read" ||
    !isNodeOfType(identifier, "Identifier") ||
    scopes.symbolFor(identifier) !== symbol ||
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== identifier ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Identifier") ||
    !propertyNames.has(member.property.name) ||
    findTransparentExpressionRoot(member) !== member ||
    isWithinAssignmentTarget(member)
  )
    return false;
  const parent = member.parent;
  if (
    !parent ||
    isNodeOfType(parent, "MemberExpression") ||
    isNodeOfType(parent, "JSXExpressionContainer")
  )
    return false;
  if (
    (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
    parent.callee === member
  )
    return false;
  return !(isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === member);
};

const getClosedStringRecordProperties = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): ReadonlySet<string> | null => {
  let propertiesBySymbol = closedRecordPropertiesByAnalysis.get(scopes);
  if (!propertiesBySymbol) {
    propertiesBySymbol = new WeakMap();
    closedRecordPropertiesByAnalysis.set(scopes, propertiesBySymbol);
  }
  const cachedProperties = propertiesBySymbol.get(symbol);
  if (cachedProperties !== undefined) return cachedProperties;
  const declarator = symbol.declarationNode;
  const propertyNames = new Set<string>();
  const isClosedRecord =
    symbol.kind === "const" &&
    isNodeOfType(declarator, "VariableDeclarator") &&
    declarator.id === symbol.bindingIdentifier &&
    isNodeOfType(declarator.init, "ObjectExpression") &&
    declarator.init.properties.every((property) => {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.method ||
        property.computed ||
        !isNodeOfType(property.value, "Literal") ||
        typeof property.value.value !== "string"
      )
        return false;
      const propertyName = getStaticPropertyKeyName(property);
      if (
        !propertyName ||
        UNSAFE_STRING_RECORD_KEYS.has(propertyName) ||
        propertyNames.has(propertyName)
      )
        return false;
      propertyNames.add(propertyName);
      return true;
    }) &&
    symbol.references.every((usage) => isClosedOwnStringRead(usage, symbol, propertyNames, scopes));
  const closedProperties = isClosedRecord ? propertyNames : null;
  propertiesBySymbol.set(symbol, closedProperties);
  return closedProperties;
};

export const isClosedStringMemberCapture = ({
  reference,
  dependencyKey,
  callback,
  hookCall,
  scopes,
}: ClosedStringMemberCaptureInput): boolean => {
  const symbol = reference.resolvedSymbol;
  const identifier = reference.identifier;
  const selectedMember = identifier.parent;
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !isNodeOfType(identifier, "Identifier") ||
    !isNodeOfType(selectedMember, "MemberExpression") ||
    selectedMember.object !== identifier ||
    selectedMember.computed ||
    selectedMember.optional ||
    !isNodeOfType(selectedMember.property, "Identifier") ||
    dependencyKey !== `${symbol.name}.${selectedMember.property.name}`
  )
    return false;
  const declarator = symbol.declarationNode;
  const declaration = declarator.parent;
  const owner = findEnclosingFunction(symbol.bindingIdentifier);
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.id !== symbol.bindingIdentifier ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.some((candidate) => candidate !== declarator) ||
    !isFunctionLike(owner) ||
    findEnclosingFunction(callback) !== owner ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    declaration.parent !== owner.body ||
    !isNodeOfType(declarator.init, "ObjectExpression")
  )
    return false;
  const [, declarationEnd] = declarator.range;
  const [callbackStart] = callback.range;
  if (!(declarationEnd < callbackStart)) return false;
  const propertyNames = getClosedStringRecordProperties(symbol, scopes);
  return Boolean(
    propertyNames?.has(selectedMember.property.name) &&
    hasValueReactDependencyHook(hookCall, callback, scopes) &&
    hasAdmittedCaptureProviders(scopes),
  );
};
