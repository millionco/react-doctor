import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const NATIVE_ARRAY_TYPE_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "ReadonlyArray",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

const typeDeclarationsByProgram = new WeakMap<EsTreeNode, Map<string, EsTreeNode>>();
const directTypeMembersByNode = new WeakMap<EsTreeNode, Map<string, EsTreeNode>>();

const getTypePropertyName = (member: EsTreeNode): string | null => {
  if (!("key" in member) || !member.key) return null;
  if (member.key.type === "Identifier") {
    return "computed" in member && member.computed ? null : member.key.name;
  }
  return member.key.type === "Literal" && typeof member.key.value === "string"
    ? member.key.value
    : null;
};

const findTypeDeclaration = (typeName: string, referenceNode: EsTreeNode): EsTreeNode | null => {
  const programRoot = findProgramRoot(referenceNode);
  if (!programRoot) return null;
  let declarationsByName = typeDeclarationsByProgram.get(programRoot);
  if (!declarationsByName) {
    declarationsByName = new Map();
    for (const statement of programRoot.body) {
      const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
        ? statement.declaration
        : statement;
      if (
        declaration &&
        (isNodeOfType(declaration, "TSInterfaceDeclaration") ||
          isNodeOfType(declaration, "TSTypeAliasDeclaration")) &&
        isNodeOfType(declaration.id, "Identifier")
      ) {
        declarationsByName.set(declaration.id.name, declaration);
      }
    }
    typeDeclarationsByProgram.set(programRoot, declarationsByName);
  }
  return declarationsByName.get(typeName) ?? null;
};

const getDirectTypeMembers = (typeNode: EsTreeNode): Map<string, EsTreeNode> | null => {
  let members: ReadonlyArray<EsTreeNode> | null = null;
  if (isNodeOfType(typeNode, "TSTypeLiteral")) members = typeNode.members;
  if (isNodeOfType(typeNode, "TSInterfaceDeclaration")) members = typeNode.body.body;
  if (!members) return null;
  let membersByName = directTypeMembersByNode.get(typeNode);
  if (!membersByName) {
    membersByName = new Map();
    for (const member of members) {
      if (!isNodeOfType(member, "TSPropertySignature")) continue;
      const propertyName = getTypePropertyName(member);
      const memberType = member.typeAnnotation?.typeAnnotation;
      if (propertyName && memberType) membersByName.set(propertyName, memberType);
    }
    directTypeMembersByNode.set(typeNode, membersByName);
  }
  return membersByName;
};

const isNativeArrayTypeNameShadowed = (typeNode: EsTreeNode, typeName: string): boolean =>
  Boolean(findVariableInitializer(typeNode, typeName) || findTypeDeclaration(typeName, typeNode));

const isNativeArrayType = (
  typeNode: EsTreeNode | null | undefined,
  referenceNode: EsTreeNode,
  visitedDeclarations = new Set<EsTreeNode>(),
): boolean => {
  if (!typeNode) return false;
  if (isNodeOfType(typeNode, "TSArrayType") || isNodeOfType(typeNode, "TSTupleType")) return true;
  if (isNodeOfType(typeNode, "TSTypeOperator")) {
    return isNativeArrayType(typeNode.typeAnnotation, referenceNode, visitedDeclarations);
  }
  if (
    !isNodeOfType(typeNode, "TSTypeReference") ||
    !isNodeOfType(typeNode.typeName, "Identifier")
  ) {
    return false;
  }
  if (
    NATIVE_ARRAY_TYPE_NAMES.has(typeNode.typeName.name) &&
    !isNativeArrayTypeNameShadowed(typeNode, typeNode.typeName.name)
  ) {
    return true;
  }
  const declaration = findTypeDeclaration(typeNode.typeName.name, referenceNode);
  if (
    !declaration ||
    !isNodeOfType(declaration, "TSTypeAliasDeclaration") ||
    visitedDeclarations.has(declaration)
  ) {
    return false;
  }
  visitedDeclarations.add(declaration);
  return isNativeArrayType(declaration.typeAnnotation, referenceNode, visitedDeclarations);
};

const getDeclaredTypeMember = (
  typeNode: EsTreeNode | null | undefined,
  propertyName: string,
  referenceNode: EsTreeNode,
  visitedDeclarations = new Set<EsTreeNode>(),
): EsTreeNode | null => {
  if (!typeNode) return null;
  const directTypeMembers = getDirectTypeMembers(typeNode);
  if (directTypeMembers) return directTypeMembers.get(propertyName) ?? null;
  if (isNodeOfType(typeNode, "TSTypeAliasDeclaration")) {
    return getDeclaredTypeMember(
      typeNode.typeAnnotation,
      propertyName,
      referenceNode,
      visitedDeclarations,
    );
  }
  if (
    !isNodeOfType(typeNode, "TSTypeReference") ||
    !isNodeOfType(typeNode.typeName, "Identifier")
  ) {
    return null;
  }
  const declaration = findTypeDeclaration(typeNode.typeName.name, referenceNode);
  if (!declaration || visitedDeclarations.has(declaration)) return null;
  visitedDeclarations.add(declaration);
  return getDeclaredTypeMember(declaration, propertyName, referenceNode, visitedDeclarations);
};

const getDestructuredBindingType = (
  bindingIdentifier: EsTreeNode,
  referenceNode: EsTreeNode,
): EsTreeNode | null => {
  let bindingElement = bindingIdentifier.parent;
  if (bindingElement && isNodeOfType(bindingElement, "AssignmentPattern")) {
    bindingElement = bindingElement.parent;
  }
  if (!bindingElement || !isNodeOfType(bindingElement, "Property")) return null;
  const pattern = bindingElement.parent;
  if (!pattern || !isNodeOfType(pattern, "ObjectPattern")) return null;
  const propertyName = getTypePropertyName(bindingElement);
  if (!propertyName) return null;
  return getDeclaredTypeMember(pattern.typeAnnotation?.typeAnnotation, propertyName, referenceNode);
};

const getIdentifierDeclaredType = (
  identifier: EsTreeNode,
  referenceNode: EsTreeNode,
): EsTreeNode | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  return (
    identifier.typeAnnotation?.typeAnnotation ??
    getDestructuredBindingType(identifier, referenceNode)
  );
};

const getMemberDeclaredType = (receiver: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(receiver, "MemberExpression")) return null;
  const propertyName = getStaticPropertyName(receiver);
  if (!propertyName) return null;
  const object = stripParenExpression(receiver.object);
  if (isNodeOfType(object, "Identifier")) {
    const binding = findVariableInitializer(object, object.name);
    if (!binding) return null;
    return getDeclaredTypeMember(
      getIdentifierDeclaredType(binding.bindingIdentifier, receiver),
      propertyName,
      receiver,
    );
  }
  if (!isNodeOfType(object, "ThisExpression")) return null;
  let ancestor: EsTreeNode | null | undefined = receiver.parent;
  while (ancestor && !isNodeOfType(ancestor, "ClassBody")) ancestor = ancestor.parent;
  if (!ancestor) return null;
  for (const classElement of ancestor.body) {
    if (
      isNodeOfType(classElement, "PropertyDefinition") &&
      getTypePropertyName(classElement) === propertyName
    ) {
      return classElement.typeAnnotation?.typeAnnotation ?? null;
    }
  }
  return null;
};

export const isProvenNativeArrayExpression = (
  expression: EsTreeNode,
  visitedBindings = new Set<EsTreeNode>(),
): boolean => {
  const receiver = stripParenExpression(expression);
  if (isNodeOfType(receiver, "ArrayExpression")) return true;
  if (isNodeOfType(receiver, "LogicalExpression") && receiver.operator === "??") {
    return (
      isProvenNativeArrayExpression(receiver.left, new Set(visitedBindings)) &&
      isProvenNativeArrayExpression(receiver.right, new Set(visitedBindings))
    );
  }
  if (isNodeOfType(receiver, "MemberExpression")) {
    return isNativeArrayType(getMemberDeclaredType(receiver), receiver);
  }
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const binding = findVariableInitializer(receiver, receiver.name);
  if (!binding || visitedBindings.has(binding.bindingIdentifier)) return false;
  const hasNativeDeclaredType = isNativeArrayType(
    getIdentifierDeclaredType(binding.bindingIdentifier, receiver),
    receiver,
  );
  if (
    hasNativeDeclaredType &&
    (!binding.initializer || isNodeOfType(binding.bindingIdentifier.parent, "AssignmentPattern"))
  ) {
    return true;
  }
  if (!binding.initializer) return false;
  const initializer = stripParenExpression(binding.initializer);
  if (
    !isNodeOfType(initializer, "Identifier") &&
    !isNodeOfType(initializer, "MemberExpression") &&
    !isNodeOfType(initializer, "LogicalExpression")
  ) {
    return false;
  }
  visitedBindings.add(binding.bindingIdentifier);
  return isProvenNativeArrayExpression(initializer, visitedBindings);
};
