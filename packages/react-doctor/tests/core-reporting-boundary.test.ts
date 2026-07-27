import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@react-doctor/core";
import type { Diagnostic as CoreSchemaDiagnostic } from "@react-doctor/core/schemas";
import * as coreReporting from "../src/core/core-reporting.js";
import type { LiveDiagnostic } from "../src/core/core-reporting.js";
import * as reactDoctorApi from "../src/index.js";
import * as ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_REPORTING_RELATIVE_PATH = "core/core-reporting.ts";
const CORE_PACKAGE_SPECIFIER = "@react-doctor/core";
const REPORTING_CAPABILITIES: ReadonlyArray<string> = [
  "buildJsonReport",
  "buildJsonReportError",
  "buildSkippedChecks",
  "isScanComplete",
];
const REPORTING_CAPABILITY_SET = new Set<string>(REPORTING_CAPABILITIES);

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

const collectDirectReportingBindings = (filePath: string): string[] => {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

  return sourceFile.statements.flatMap((statement) => {
    if (
      (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) ||
      statement.moduleSpecifier === undefined ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== CORE_PACKAGE_SPECIFIER
    ) {
      return [];
    }

    const namedBindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : statement.exportClause;
    if (
      namedBindings === undefined ||
      ts.isNamespaceImport(namedBindings) ||
      ts.isNamespaceExport(namedBindings)
    ) {
      return [...REPORTING_CAPABILITIES];
    }

    return namedBindings.elements.flatMap((element) => {
      const importedName = (element.propertyName ?? element.name).text;
      return REPORTING_CAPABILITY_SET.has(importedName) ? [importedName] : [];
    });
  });
};

describe("React Doctor core reporting boundary", () => {
  it("routes every production reporting capability through one adapter", () => {
    const directDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      const importedCapabilities = collectDirectReportingBindings(filePath);
      if (importedCapabilities.length === 0) return [];

      return [
        `${path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")}: ${importedCapabilities.join(", ")}`,
      ];
    });

    expect(directDependents).toEqual([
      `${CORE_REPORTING_RELATIVE_PATH}: ${REPORTING_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes the adapter's runtime capability set and identities", () => {
    expect(Object.keys(coreReporting).sort()).toEqual([...REPORTING_CAPABILITIES].sort());
    expect(coreReporting).toMatchObject({
      buildJsonReport: core.buildJsonReport,
      buildJsonReportError: core.buildJsonReportError,
      buildSkippedChecks: core.buildSkippedChecks,
      isScanComplete: core.isScanComplete,
    });
  });

  it("preserves the public reporting facade identities", () => {
    expect(reactDoctorApi).toMatchObject({
      buildJsonReport: core.buildJsonReport,
      buildJsonReportError: core.buildJsonReportError,
    });
  });

  it("preserves the schema-derived live diagnostic type exactly", () => {
    expectTypeOf<LiveDiagnostic>().toEqualTypeOf<CoreSchemaDiagnostic>();
  });
});
