import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findSameFileTypeDeclarations } from "./find-same-file-type-declaration.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { hasEnclosingTypeParameterNamed } from "./has-enclosing-type-parameter-named.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReadonlyNamedReactCall } from "./is-readonly-named-react-call.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveRelativeImportPath } from "./resolve-relative-import-path.js";

interface PromiseReturningPropInput {
  callee: EsTreeNode;
  filename: string | undefined;
  scopes: ScopeAnalysis;
  reserveImport: (specifier: string) => boolean;
}

const getTypeImport = (reference: EsTreeNode, name: string) => {
  const program = findProgramRoot(reference);
  if (!program || findSameFileTypeDeclarations(reference, name).length > 0) return null;
  for (const statement of program.body) {
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.local.name !== name) continue;
      if (
        !isNodeOfType(specifier, "ImportSpecifier") ||
        (statement.importKind !== "type" && specifier.importKind !== "type") ||
        typeof statement.source.value !== "string" ||
        !(statement.source.value.startsWith("./") || statement.source.value.startsWith("../"))
      ) {
        return null;
      }
      const importedName = getImportedName(specifier);
      return importedName ? { importedName, source: statement.source.value } : null;
    }
  }
  return null;
};

export const isDeclaredPromiseReturningProp = ({
  callee,
  filename,
  scopes,
  reserveImport,
}: PromiseReturningPropInput): boolean => {
  if (!filename || !isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  if (symbol?.kind !== "parameter" || !isSymbolReadOnly(symbol)) return false;
  const property = symbol.bindingIdentifier.parent;
  const pattern = property?.parent;
  const owner = pattern?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.value !== symbol.bindingIdentifier ||
    !isNodeOfType(pattern, "ObjectPattern") ||
    !isFunctionLike(owner) ||
    owner.params[0] !== pattern
  ) {
    return false;
  }
  const propertyName = getStaticKeyName(property.key);
  if (!propertyName) return false;

  const callback = findTransparentExpressionRoot(owner);
  const wrapper = callback.parent;
  if (
    !isNodeOfType(wrapper, "CallExpression") ||
    wrapper.optional ||
    wrapper.arguments[0] !== callback ||
    !isReadonlyNamedReactCall(wrapper, "forwardRef", scopes)
  ) {
    return false;
  }
  const declarator = findTransparentExpressionRoot(wrapper).parent;
  const declaration = declarator?.parent;
  const topLevel = declaration?.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    (!isNodeOfType(topLevel, "Program") &&
      !(
        isNodeOfType(topLevel, "ExportNamedDeclaration") && isNodeOfType(topLevel.parent, "Program")
      ))
  ) {
    return false;
  }
  const propsType = wrapper.typeArguments?.params[1];
  if (
    !isNodeOfType(propsType, "TSTypeReference") ||
    !isNodeOfType(propsType.typeName, "Identifier") ||
    propsType.typeArguments ||
    hasEnclosingTypeParameterNamed(propsType, propsType.typeName.name)
  ) {
    return false;
  }
  const imported = getTypeImport(propsType, propsType.typeName.name);
  if (!imported || !reserveImport(imported.source)) return false;
  const modulePath = resolveRelativeImportPath(filename, imported.source);
  const program = modulePath ? parseSourceFile(modulePath) : null;
  if (!isNodeOfType(program, "Program")) return false;

  const declarations = findSameFileTypeDeclarations(program, imported.importedName);
  const propsDeclaration = declarations[0];
  if (
    declarations.length !== 1 ||
    !isNodeOfType(propsDeclaration, "TSInterfaceDeclaration") ||
    !isNodeOfType(propsDeclaration.parent, "ExportNamedDeclaration") ||
    propsDeclaration.typeParameters
  ) {
    return false;
  }
  const matchingMembers = propsDeclaration.body.body.filter(
    (member) =>
      (isNodeOfType(member, "TSPropertySignature") || isNodeOfType(member, "TSMethodSignature")) &&
      !member.computed &&
      getStaticKeyName(member.key) === propertyName,
  );
  const member = matchingMembers[0];
  if (matchingMembers.length !== 1 || !isNodeOfType(member, "TSPropertySignature")) return false;
  const callbackType = member.typeAnnotation?.typeAnnotation;
  if (!isNodeOfType(callbackType, "TSFunctionType") || callbackType.typeParameters) return false;
  const returnType = callbackType.returnType?.typeAnnotation;
  if (!isNodeOfType(returnType, "TSUnionType") || returnType.types.length !== 2) return false;
  const promiseType = returnType.types.find(
    (alternative) =>
      isNodeOfType(alternative, "TSTypeReference") &&
      isNodeOfType(alternative.typeName, "Identifier") &&
      alternative.typeName.name === "Promise" &&
      alternative.typeArguments?.params.length === 1 &&
      isNodeOfType(alternative.typeArguments.params[0], "TSVoidKeyword"),
  );
  return Boolean(
    promiseType &&
    returnType.types.some((alternative) => isNodeOfType(alternative, "TSVoidKeyword")) &&
    !hasEnclosingTypeParameterNamed(promiseType, "Promise") &&
    findSameFileTypeDeclarations(program, "Promise").length === 0 &&
    !analyzeScopes(program).rootScope.symbolsByName.has("Promise"),
  );
};
