import type { Reference } from "eslint-scope";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../../utils/find-program-root.js";
import { hasEnclosingTypeParameterNamed } from "../../../../utils/has-enclosing-type-parameter-named.js";
import { isNodeOfType } from "../../../../utils/is-node-of-type.js";
import { walkAst } from "../../../../utils/walk-ast.js";

const ARRAY_READ_METHOD_NAMES: ReadonlySet<string> = new Set([
  "at",
  "concat",
  "entries",
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flat",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "keys",
  "lastIndexOf",
  "map",
  "reduce",
  "reduceRight",
  "slice",
  "some",
  "toLocaleString",
  "toReversed",
  "toSorted",
  "toSpliced",
  "toString",
  "values",
  "with",
]);

const MAP_READ_METHOD_NAMES: ReadonlySet<string> = new Set([
  "entries",
  "forEach",
  "get",
  "has",
  "keys",
  "values",
]);

const SET_READ_METHOD_NAMES: ReadonlySet<string> = new Set([
  "difference",
  "entries",
  "forEach",
  "has",
  "intersection",
  "isDisjointFrom",
  "isSubsetOf",
  "isSupersetOf",
  "keys",
  "symmetricDifference",
  "union",
  "values",
]);

const FUNCTION_READ_METHOD_NAMES: ReadonlySet<string> = new Set(["bind"]);

const PROMISE_READ_METHOD_NAMES: ReadonlySet<string> = new Set(["catch", "finally", "then"]);

const STRING_READ_METHOD_NAMES: ReadonlySet<string> = new Set([
  "at",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "concat",
  "endsWith",
  "includes",
  "indexOf",
  "isWellFormed",
  "lastIndexOf",
  "localeCompare",
  "match",
  "matchAll",
  "normalize",
  "padEnd",
  "padStart",
  "repeat",
  "replace",
  "replaceAll",
  "search",
  "slice",
  "split",
  "startsWith",
  "substring",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "toLowerCase",
  "toString",
  "toUpperCase",
  "toWellFormed",
  "trim",
  "trimEnd",
  "trimStart",
  "valueOf",
]);

const NATIVE_TYPE_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "Map",
  "Promise",
  "PromiseLike",
  "ReadonlyArray",
  "ReadonlyMap",
  "ReadonlySet",
  "Set",
]);

interface NativeTypeDeclaration {
  name: string;
  scope: EsTreeNode;
}

const nativeTypeDeclarationsByProgram: WeakMap<EsTreeNode, NativeTypeDeclaration[]> = new WeakMap();
const shadowedNativeTypeNamesByBinding: WeakMap<EsTreeNode, ReadonlySet<string>> = new WeakMap();

const isWithinNode = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
};

const findTypeDeclarationScope = (declaration: EsTreeNode): EsTreeNode | null => {
  let current = declaration.parent;
  while (current) {
    if (
      isNodeOfType(current, "Program") ||
      isNodeOfType(current, "BlockStatement") ||
      isNodeOfType(current, "TSModuleBlock") ||
      isNodeOfType(current, "StaticBlock")
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
};

const getDeclaredTypeName = (declaration: EsTreeNode): string | null => {
  if (
    !isNodeOfType(declaration, "ClassDeclaration") &&
    !isNodeOfType(declaration, "TSEnumDeclaration") &&
    !isNodeOfType(declaration, "TSImportEqualsDeclaration") &&
    !isNodeOfType(declaration, "TSInterfaceDeclaration") &&
    !isNodeOfType(declaration, "TSModuleDeclaration") &&
    !isNodeOfType(declaration, "TSTypeAliasDeclaration")
  ) {
    return null;
  }
  return declaration.id && isNodeOfType(declaration.id, "Identifier") ? declaration.id.name : null;
};

const getNativeTypeDeclarations = (program: EsTreeNode): NativeTypeDeclaration[] => {
  const cachedDeclarations = nativeTypeDeclarationsByProgram.get(program);
  if (cachedDeclarations) return cachedDeclarations;
  const declarations: NativeTypeDeclaration[] = [];
  walkAst(program, (candidate) => {
    if (isNodeOfType(candidate, "ImportDeclaration")) {
      for (const specifier of candidate.specifiers) {
        if (NATIVE_TYPE_NAMES.has(specifier.local.name)) {
          declarations.push({ name: specifier.local.name, scope: program });
        }
      }
      return;
    }
    const declaredTypeName = getDeclaredTypeName(candidate);
    if (!declaredTypeName || !NATIVE_TYPE_NAMES.has(declaredTypeName)) return;
    const declarationScope = findTypeDeclarationScope(candidate);
    if (declarationScope) declarations.push({ name: declaredTypeName, scope: declarationScope });
  });
  nativeTypeDeclarationsByProgram.set(program, declarations);
  return declarations;
};

const getShadowedNativeTypeNames = (binding: EsTreeNode): ReadonlySet<string> => {
  const cachedNames = shadowedNativeTypeNamesByBinding.get(binding);
  if (cachedNames) return cachedNames;
  const shadowedNames = new Set<string>();
  for (const typeName of NATIVE_TYPE_NAMES) {
    if (hasEnclosingTypeParameterNamed(binding, typeName)) shadowedNames.add(typeName);
  }
  const program = findProgramRoot(binding);
  if (program) {
    for (const declaration of getNativeTypeDeclarations(program)) {
      if (isWithinNode(binding, declaration.scope)) shadowedNames.add(declaration.name);
    }
  }
  shadowedNativeTypeNamesByBinding.set(binding, shadowedNames);
  return shadowedNames;
};

const getParameterBinding = (definitionName: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(definitionName, "Identifier")) return definitionName;
  if (!isNodeOfType(definitionName, "AssignmentPattern")) return null;
  return isNodeOfType(definitionName.left, "Identifier") ? definitionName.left : null;
};

const getTypeAnnotation = (binding: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(binding, "Identifier")) return null;
  const annotation = binding.typeAnnotation;
  return annotation && isNodeOfType(annotation, "TSTypeAnnotation")
    ? annotation.typeAnnotation
    : null;
};

const isNullishType = (typeNode: EsTreeNode): boolean =>
  isNodeOfType(typeNode, "TSNullKeyword") || isNodeOfType(typeNode, "TSUndefinedKeyword");

const isNativeReadMethod = (
  typeNode: EsTreeNode,
  methodName: string,
  shadowedTypeNames: ReadonlySet<string>,
): boolean => {
  if (isNodeOfType(typeNode, "TSArrayType") || isNodeOfType(typeNode, "TSTupleType")) {
    return ARRAY_READ_METHOD_NAMES.has(methodName);
  }
  if (isNodeOfType(typeNode, "TSStringKeyword")) return STRING_READ_METHOD_NAMES.has(methodName);
  if (isNodeOfType(typeNode, "TSFunctionType")) {
    return FUNCTION_READ_METHOD_NAMES.has(methodName);
  }
  if (
    isNodeOfType(typeNode, "TSLiteralType") &&
    isNodeOfType(typeNode.literal, "Literal") &&
    typeof typeNode.literal.value === "string"
  ) {
    return STRING_READ_METHOD_NAMES.has(methodName);
  }
  if (
    isNodeOfType(typeNode, "TSTypeOperator") &&
    typeNode.operator === "readonly" &&
    typeNode.typeAnnotation
  ) {
    return isNativeReadMethod(typeNode.typeAnnotation, methodName, shadowedTypeNames);
  }
  if (isNodeOfType(typeNode, "TSUnionType")) {
    let hasNonNullishMember = false;
    for (const memberType of typeNode.types) {
      if (isNullishType(memberType)) continue;
      hasNonNullishMember = true;
      if (!isNativeReadMethod(memberType, methodName, shadowedTypeNames)) return false;
    }
    return hasNonNullishMember;
  }
  if (
    !isNodeOfType(typeNode, "TSTypeReference") ||
    !isNodeOfType(typeNode.typeName, "Identifier")
  ) {
    return false;
  }
  if (shadowedTypeNames.has(typeNode.typeName.name)) return false;
  if (typeNode.typeName.name === "Array" || typeNode.typeName.name === "ReadonlyArray") {
    return ARRAY_READ_METHOD_NAMES.has(methodName);
  }
  if (typeNode.typeName.name === "Map" || typeNode.typeName.name === "ReadonlyMap") {
    return MAP_READ_METHOD_NAMES.has(methodName);
  }
  if (typeNode.typeName.name === "Set" || typeNode.typeName.name === "ReadonlySet") {
    return SET_READ_METHOD_NAMES.has(methodName);
  }
  if (typeNode.typeName.name === "Promise" || typeNode.typeName.name === "PromiseLike") {
    return PROMISE_READ_METHOD_NAMES.has(methodName);
  }
  return false;
};

export const isProvenNativeReadMethod = (ref: Reference, methodName: string): boolean =>
  Boolean(
    ref.resolved?.defs.some((definition) => {
      if (definition.type !== "Parameter") return false;
      const parameterBinding = getParameterBinding(definition.name as unknown as EsTreeNode);
      if (!parameterBinding) return false;
      const typeAnnotation = getTypeAnnotation(parameterBinding);
      return Boolean(
        typeAnnotation &&
        isNativeReadMethod(
          typeAnnotation,
          methodName,
          getShadowedNativeTypeNames(parameterBinding),
        ),
      );
    }),
  );
