import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isOctanePackageSource } from "./is-octane-package-source.js";
import { isNodeOfType } from "./is-node-of-type.js";

const OCTANE_JSX_IMPORT_SOURCE_PATTERN =
  /@jsxImportSource\s+(?:octane(?:\/[^\s*]+)?|@octanejs\/[^\s*]+\/intrinsics)\b/;

const hasRuntimeImportSpecifier = (declaration: EsTreeNodeOfType<"ImportDeclaration">): boolean =>
  declaration.importKind !== "type" &&
  (declaration.specifiers.length === 0 ||
    declaration.specifiers.some(
      (specifier) => !isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind !== "type",
    ));

export const isOctaneModule = (program: EsTreeNodeOfType<"Program">, sourceText: string): boolean =>
  OCTANE_JSX_IMPORT_SOURCE_PATTERN.test(sourceText) ||
  program.body.some(
    (statement) =>
      isNodeOfType(statement, "ImportDeclaration") &&
      typeof statement.source.value === "string" &&
      isOctanePackageSource(statement.source.value) &&
      hasRuntimeImportSpecifier(statement),
  );
