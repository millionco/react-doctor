import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const ZOD_MODULE = "zod";

interface ZodImportInfo {
  imported: string | null;
  isDefault: boolean;
  isNamespace: boolean;
}

interface MethodCall {
  methodName: string;
  receiver: EsTreeNode;
}

export const getStaticPropertyName = (
  member: EsTreeNodeOfType<"MemberExpression">,
): string | null => {
  const property = member.property as EsTreeNode;
  if (!member.computed && isNodeOfType(property, "Identifier")) return property.name;
  if (member.computed && isNodeOfType(property, "Literal") && typeof property.value === "string") {
    return property.value;
  }
  return null;
};

const getImportInfoForIdentifier = (
  identifier: EsTreeNodeOfType<"Identifier">,
): ZodImportInfo | null => {
  const binding = findVariableInitializer(identifier, identifier.name);
  const specifier = binding?.initializer;
  if (!specifier) return null;

  const declaration = specifier.parent;
  if (!declaration || !isNodeOfType(declaration, "ImportDeclaration")) return null;
  const source = declaration.source?.value;
  if (source !== ZOD_MODULE) return null;

  if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
    return { imported: null, isDefault: false, isNamespace: true };
  }
  if (isNodeOfType(specifier, "ImportDefaultSpecifier")) {
    return { imported: null, isDefault: true, isNamespace: false };
  }
  if (isNodeOfType(specifier, "ImportSpecifier")) {
    const imported = specifier.imported as EsTreeNode;
    if (isNodeOfType(imported, "Identifier")) {
      return { imported: imported.name, isDefault: false, isNamespace: false };
    }
    if (isNodeOfType(imported, "Literal") && typeof imported.value === "string") {
      return { imported: imported.value, isDefault: false, isNamespace: false };
    }
  }
  return null;
};

export const isZodNamespaceIdentifier = (node: EsTreeNode): boolean => {
  const inner = stripParenExpression(node);
  if (!isNodeOfType(inner, "Identifier")) return false;
  const info = getImportInfoForIdentifier(inner);
  return Boolean(info && (info.isNamespace || info.isDefault || info.imported === "z"));
};

export const getZodNamedImport = (node: EsTreeNode): string | null => {
  const inner = stripParenExpression(node);
  if (!isNodeOfType(inner, "Identifier")) return null;
  const info = getImportInfoForIdentifier(inner);
  if (!info || info.isNamespace || info.isDefault) return null;
  return info.imported;
};

export const getZodNamespaceMemberName = (node: EsTreeNode): string | null => {
  const inner = stripParenExpression(node);
  if (!isNodeOfType(inner, "MemberExpression")) return null;
  if (!isZodNamespaceIdentifier(inner.object as EsTreeNode)) return null;
  return getStaticPropertyName(inner);
};

export const isZodFactoryCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  factoryNames: ReadonlySet<string>,
): boolean => {
  const factoryName = getZodFactoryCallName(callExpression);
  return factoryName !== null && factoryNames.has(factoryName);
};

export const getZodFactoryCallName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const callee = stripParenExpression(callExpression.callee as EsTreeNode);
  if (isNodeOfType(callee, "Identifier")) {
    const imported = getZodNamedImport(callee);
    return imported;
  }
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const memberName = getStaticPropertyName(callee);
  if (memberName === null) return null;
  if (!isZodNamespaceIdentifier(callee.object as EsTreeNode)) return null;
  return memberName;
};

export const getMethodCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): MethodCall | null => {
  const callee = stripParenExpression(callExpression.callee as EsTreeNode);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  if (!methodName) return null;
  return { methodName, receiver: callee.object as EsTreeNode };
};

export const isDirectMethodCallOnZodFactory = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  factoryNames: ReadonlySet<string>,
  methodNames: ReadonlySet<string>,
): boolean => {
  const methodCall = getMethodCall(callExpression);
  if (!methodCall || !methodNames.has(methodCall.methodName)) return false;
  const receiver = stripParenExpression(methodCall.receiver);
  return isNodeOfType(receiver, "CallExpression") && isZodFactoryCall(receiver, factoryNames);
};

export const isObjectExpressionWithAnyProperty = (
  node: EsTreeNode | null | undefined,
  propertyNames: ReadonlySet<string>,
): boolean => {
  if (!node) return false;
  const inner = stripParenExpression(node);
  if (!isNodeOfType(inner, "ObjectExpression")) return false;
  return inner.properties.some((property) => {
    if (!isNodeOfType(property as EsTreeNode, "Property")) return false;
    const key = (property as EsTreeNodeOfType<"Property">).key as EsTreeNode;
    if (isNodeOfType(key, "Identifier")) return propertyNames.has(key.name);
    return (
      isNodeOfType(key, "Literal") && typeof key.value === "string" && propertyNames.has(key.value)
    );
  });
};
