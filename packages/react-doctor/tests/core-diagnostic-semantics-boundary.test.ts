import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@react-doctor/core";
import * as coreDiagnosticSemantics from "../src/core/core-diagnostic-semantics.js";
import * as ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_DIAGNOSTIC_SEMANTICS_RELATIVE_PATH = "core/core-diagnostic-semantics.ts";
const CORE_PACKAGE_SPECIFIER = "@react-doctor/core";
const DIAGNOSTIC_SEMANTICS_CAPABILITIES = [
  "canonicalizeUserRuleKey",
  "computeDiagnosticDelta",
  "DIAGNOSTIC_CATEGORY_BUCKETS",
  "filterDiagnosticsForSurface",
  "getDiagnosticRuleIdentity",
  "getEquivalentRuleKeys",
  "groupBy",
  "isSameRuleKey",
  "summarizeDiagnostics",
] as const;
const DIAGNOSTIC_SEMANTICS_CAPABILITY_SET = new Set<string>(DIAGNOSTIC_SEMANTICS_CAPABILITIES);

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

const collectDirectDiagnosticSemanticsBindings = (filePath: string): string[] => {
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
      return [...DIAGNOSTIC_SEMANTICS_CAPABILITIES];
    }

    return namedBindings.elements.flatMap((element) => {
      const importedName = (element.propertyName ?? element.name).text;
      return DIAGNOSTIC_SEMANTICS_CAPABILITY_SET.has(importedName) ? [importedName] : [];
    });
  });
};

describe("React Doctor core diagnostic semantics boundary", () => {
  it("routes every production diagnostic semantics capability through one adapter", () => {
    const directDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      const importedCapabilities = collectDirectDiagnosticSemanticsBindings(filePath);
      if (importedCapabilities.length === 0) return [];

      return [
        `${path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")}: ${importedCapabilities.join(", ")}`,
      ];
    });

    expect(directDependents).toEqual([
      `${CORE_DIAGNOSTIC_SEMANTICS_RELATIVE_PATH}: ${DIAGNOSTIC_SEMANTICS_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes the adapter's runtime capability set and identities", () => {
    expect(Object.keys(coreDiagnosticSemantics).sort()).toEqual(
      [...DIAGNOSTIC_SEMANTICS_CAPABILITIES].sort(),
    );
    expect(coreDiagnosticSemantics).toMatchObject({
      canonicalizeUserRuleKey: core.canonicalizeUserRuleKey,
      computeDiagnosticDelta: core.computeDiagnosticDelta,
      DIAGNOSTIC_CATEGORY_BUCKETS: core.DIAGNOSTIC_CATEGORY_BUCKETS,
      filterDiagnosticsForSurface: core.filterDiagnosticsForSurface,
      getDiagnosticRuleIdentity: core.getDiagnosticRuleIdentity,
      getEquivalentRuleKeys: core.getEquivalentRuleKeys,
      groupBy: core.groupBy,
      isSameRuleKey: core.isSameRuleKey,
      summarizeDiagnostics: core.summarizeDiagnostics,
    });
  });
});
