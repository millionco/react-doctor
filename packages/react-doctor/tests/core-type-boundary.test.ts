import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_TYPES_RELATIVE_PATH = "core/core-types.ts";
const CORE_PACKAGE_SPECIFIER = "@react-doctor/core";
const CORE_ADAPTER_DIRECTORY = "core";
const CORE_ADAPTER_FILE_PATTERN = /^core-[a-z0-9-]+\.ts$/;

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

const isTypeOnlyDeclaration = (
  declaration: ts.ImportDeclaration | ts.ExportDeclaration,
): boolean => {
  if (ts.isImportDeclaration(declaration)) {
    const importClause = declaration.importClause;
    if (importClause?.isTypeOnly) return true;
    return (
      importClause?.namedBindings !== undefined &&
      ts.isNamedImports(importClause.namedBindings) &&
      importClause.namedBindings.elements.every((element) => element.isTypeOnly)
    );
  }

  if (declaration.isTypeOnly) return true;
  return (
    declaration.exportClause !== undefined &&
    ts.isNamedExports(declaration.exportClause) &&
    declaration.exportClause.elements.every((element) => element.isTypeOnly)
  );
};

const collectCoreDeclarations = (
  filePath: string,
): ReadonlyArray<ts.ImportDeclaration | ts.ExportDeclaration> => {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  return sourceFile.statements.filter(
    (statement): statement is ts.ImportDeclaration | ts.ExportDeclaration =>
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === CORE_PACKAGE_SPECIFIER,
  );
};

const containsCorePackageSpecifier = (filePath: string): boolean => {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let containsSpecifier = false;
  const visitNode = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) &&
      (node.text === CORE_PACKAGE_SPECIFIER || node.text.startsWith(`${CORE_PACKAGE_SPECIFIER}/`))
    ) {
      containsSpecifier = true;
      return;
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sourceFile);
  return containsSpecifier;
};

describe("React Doctor core type boundary", () => {
  it("routes every production core package dependency through an explicit adapter", () => {
    const directCoreDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      if (!containsCorePackageSpecifier(filePath)) return [];

      const relativePath = path.relative(SOURCE_DIRECTORY, filePath);
      const isCoreAdapter =
        path.dirname(relativePath) === CORE_ADAPTER_DIRECTORY &&
        CORE_ADAPTER_FILE_PATTERN.test(path.basename(relativePath));
      return isCoreAdapter ? [] : [relativePath.replaceAll(path.sep, "/")];
    });

    expect(directCoreDependents).toEqual([]);
  });

  it("routes every pure type-only core dependency through one adapter", () => {
    const pureTypeCoreDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      const declarations = collectCoreDeclarations(filePath);
      return declarations.length > 0 && declarations.every(isTypeOnlyDeclaration)
        ? [path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")]
        : [];
    });

    expect(pureTypeCoreDependents).toEqual([CORE_TYPES_RELATIVE_PATH]);
  });

  it("freezes the adapter's type capability set", () => {
    const adapterPath = path.join(SOURCE_DIRECTORY, CORE_TYPES_RELATIVE_PATH);
    const exportedNames = collectCoreDeclarations(adapterPath).flatMap((declaration) =>
      ts.isExportDeclaration(declaration) &&
      declaration.exportClause !== undefined &&
      ts.isNamedExports(declaration.exportClause)
        ? declaration.exportClause.elements.map((element) => element.name.text)
        : [],
    );

    expect(exportedNames.sort()).toEqual(
      [
        "BlockingLevel",
        "ChangedFileLineRanges",
        "Diagnostic",
        "DiagnosticSurface",
        "DiagnoseOptions",
        "DiagnoseProjectsInput",
        "DiagnoseProjectsResult",
        "DiagnoseResult",
        "DiffInfo",
        "GitBaselineDiffPlan",
        "HandleErrorOptions",
        "InspectOptions",
        "InspectOutput",
        "InspectResult",
        "LegacyConfigLocation",
        "MaterializedTree",
        "Progress",
        "ProgressHandle",
        "ProjectDefinition",
        "ProjectInfo",
        "ProjectResult",
        "ProjectResultError",
        "ProjectResultOk",
        "PromptMultiselectChoiceState",
        "PromptMultiselectContext",
        "ReactDoctorConfigFormat",
        "Reporter",
        "ResolvedScanTarget",
        "ScopeValue",
        "ScoreResult",
        "StagedSnapshot",
        "SuppressedRuleCount",
        "WorkerSlots",
        "WorkspacePackage",
      ].sort(),
    );
  });
});
