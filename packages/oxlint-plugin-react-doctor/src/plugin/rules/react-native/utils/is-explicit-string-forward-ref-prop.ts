import type { ScopeAnalysis, ScopeDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { hasClosedStringForwardRefProvider } from "./has-closed-string-forward-ref-provider.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import {
  FIRST_NATIVE_PROP_BINDING_INDEX,
  FORWARD_REF_CALLBACK_ARGUMENT_COUNT,
  FORWARD_REF_MAX_PARAMETER_COUNT,
  SINGLE_STRING_PROP_DECLARATION_COUNT,
} from "./constants.js";

export const isExplicitStringForwardRefProp = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || symbol.kind !== "parameter") return false;
  const property = symbol.bindingIdentifier.parent;
  const pattern = property?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.value !== symbol.bindingIdentifier ||
    !isNodeOfType(pattern, "ObjectPattern")
  ) {
    return false;
  }
  const callback = pattern.parent;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.typeParameters ||
    callback.params[FIRST_NATIVE_PROP_BINDING_INDEX] !== pattern ||
    callback.params.length > FORWARD_REF_MAX_PARAMETER_COUNT
  ) {
    return false;
  }
  const call = callback.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== FORWARD_REF_CALLBACK_ARGUMENT_COUNT ||
    call.arguments[FIRST_NATIVE_PROP_BINDING_INDEX] !== callback ||
    !isReactApiCall(call, "forwardRef", scopes)
  ) {
    return false;
  }
  const callee = call.callee;
  let providerIdentifier: EsTreeNodeOfType<"Identifier"> | null = null;
  if (isNodeOfType(callee, "Identifier")) {
    providerIdentifier = callee;
  } else if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier")
  ) {
    providerIdentifier = callee.object;
  }
  if (!providerIdentifier) return false;
  const providerSymbol = scopes.symbolFor(providerIdentifier);
  const specifier = providerSymbol?.declarationNode;
  const declaration = specifier?.parent;
  if (
    !providerSymbol ||
    providerSymbol.kind !== "import" ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    typeof declaration.source.value !== "string" ||
    isTypeOnlyImport(declaration) ||
    (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
  ) {
    return false;
  }
  if (
    symbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  )
    return false;
  const annotation = pattern.typeAnnotation;
  if (!annotation || !isNodeOfType(annotation, "TSTypeAnnotation")) return false;
  const typeNode = annotation.typeAnnotation;
  let members: ReadonlyArray<EsTreeNode>;
  if (isNodeOfType(typeNode, "TSTypeLiteral")) {
    members = typeNode.members;
  } else if (
    isNodeOfType(typeNode, "TSTypeReference") &&
    isNodeOfType(typeNode.typeName, "Identifier") &&
    !typeNode.typeArguments
  ) {
    const interfaceName = typeNode.typeName.name;
    let signatureScope: ScopeDescriptor | null = scopes.scopeFor(callback);
    let interfaceDeclaration: EsTreeNode | null = null;
    while (signatureScope) {
      const declarations = signatureScope.symbols.filter(
        (candidate) => candidate.name === interfaceName,
      );
      if (declarations.length) {
        if (declarations.length !== SINGLE_STRING_PROP_DECLARATION_COUNT) return false;
        interfaceDeclaration = declarations[FIRST_NATIVE_PROP_BINDING_INDEX].declarationNode;
        break;
      }
      signatureScope = signatureScope.parent;
    }
    if (
      !isNodeOfType(interfaceDeclaration, "TSInterfaceDeclaration") ||
      interfaceDeclaration.typeParameters ||
      scopes.scopeFor(interfaceDeclaration) !== signatureScope
    ) {
      return false;
    }
    members = interfaceDeclaration.body.body;
  } else {
    return false;
  }
  const propertyName = getStaticKeyName(property.key);
  if (propertyName === null) return false;
  const matchingMembers = members.filter(
    (member) => "key" in member && getStaticKeyName(member.key) === propertyName,
  );
  if (matchingMembers.length !== SINGLE_STRING_PROP_DECLARATION_COUNT) return false;
  const selectedMember = matchingMembers[FIRST_NATIVE_PROP_BINDING_INDEX];
  if (
    !isNodeOfType(selectedMember, "TSPropertySignature") ||
    selectedMember.computed ||
    !isNodeOfType(selectedMember.typeAnnotation?.typeAnnotation, "TSStringKeyword")
  ) {
    return false;
  }
  if (
    isNodeOfType(typeNode, "TSTypeLiteral") &&
    !isNodeOfType(getSymbolTypeAnnotation(symbol), "TSStringKeyword")
  ) {
    return false;
  }
  return hasClosedStringForwardRefProvider(scopes, declaration.source.value);
};
