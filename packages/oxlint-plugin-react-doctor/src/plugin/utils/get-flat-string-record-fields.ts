import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findSameFileTypeDeclarations } from "./find-same-file-type-declaration.js";
import { findVisibleSymbol } from "./find-visible-symbol.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { getSymbolTypeAnnotation } from "./get-symbol-type-annotation.js";
import { hasEnclosingTypeParameterNamed } from "./has-enclosing-type-parameter-named.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveModulePath } from "./resolve-module-path.js";
import type { RuleContext } from "./rule-context.js";
import { someAst } from "./some-ast.js";

const conflictsByProgram = new WeakMap<EsTreeNode, WeakMap<EsTreeNode, boolean>>();

const hasConflictingRecordDeclaration = (
  program: EsTreeNode,
  selected: EsTreeNode,
  name: string,
): boolean => {
  let conflictsByDeclaration = conflictsByProgram.get(program);
  if (!conflictsByDeclaration) {
    conflictsByDeclaration = new WeakMap();
    conflictsByProgram.set(program, conflictsByDeclaration);
  }
  const cached = conflictsByDeclaration.get(selected);
  if (cached !== undefined) return cached;
  const conflicting = someAst(program, (node) => {
    if (node === selected) return false;
    if (
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration") ||
      isNodeOfType(node, "ClassDeclaration") ||
      isNodeOfType(node, "ClassExpression") ||
      isNodeOfType(node, "TSEnumDeclaration")
    ) {
      return node.id?.name === name;
    }
    return isNodeOfType(node, "TSModuleDeclaration");
  });
  conflictsByDeclaration.set(selected, conflicting);
  return conflicting;
};

export const getFlatStringRecordFields = (
  record: SymbolDescriptor,
  context: RuleContext,
): ReadonlySet<string> | null => {
  const annotation = getSymbolTypeAnnotation(record);
  if (
    !isNodeOfType(annotation, "TSTypeReference") ||
    annotation.typeArguments ||
    !isNodeOfType(annotation.typeName, "Identifier") ||
    hasEnclosingTypeParameterNamed(record.bindingIdentifier, annotation.typeName.name)
  ) {
    return null;
  }
  const symbol = findVisibleSymbol(annotation.typeName, context.scopes);
  if (!symbol) return null;
  let program: EsTreeNode | null = findProgramRoot(annotation);
  let name = annotation.typeName.name;
  const imported = getImportDeclarationForSymbol(symbol);
  if (imported) {
    const importedName = getImportedName(symbol.declarationNode);
    if (!importedName || symbol.references.some((reference) => reference.flag !== "read")) {
      return null;
    }
    if (!context.filename) return null;
    const path = resolveModulePath(context.filename, imported.source.value);
    program = path ? parseSourceFile(path) : null;
    name = importedName;
  } else if (symbol.kind !== "ts-interface") {
    return null;
  }
  if (!program) return null;
  const declarations = findSameFileTypeDeclarations(program, name);
  const declaration = declarations[0];
  if (
    declarations.length !== 1 ||
    !isNodeOfType(declaration, "TSInterfaceDeclaration") ||
    declaration.typeParameters ||
    declaration.extends.length > 0 ||
    declaration.declare ||
    hasConflictingRecordDeclaration(program, declaration, name) ||
    (imported &&
      (!isNodeOfType(declaration.parent, "ExportNamedDeclaration") ||
        declaration.parent.declaration !== declaration))
  ) {
    return null;
  }
  const fields = new Set<string>();
  for (const member of declaration.body.body) {
    if (
      !isNodeOfType(member, "TSPropertySignature") ||
      member.computed ||
      member.optional ||
      !isNodeOfType(member.typeAnnotation?.typeAnnotation, "TSStringKeyword")
    ) {
      return null;
    }
    const field = getStaticKeyName(member.key);
    if (!field || fields.has(field)) return null;
    fields.add(field);
  }
  return fields.size > 0 ? fields : null;
};
