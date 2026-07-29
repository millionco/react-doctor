import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@react-doctor/core";
import * as coreRuntime from "../src/core/core-runtime.js";
import * as ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_RUNTIME_RELATIVE_PATH = "core/core-runtime.ts";
const CORE_PACKAGE_SPECIFIER = "@react-doctor/core";
const RUNTIME_CAPABILITIES = [
  "Config",
  "createOxlintSpawnSlots",
  "DeadCode",
  "DEFAULT_PROJECT_SCAN_CONCURRENCY",
  "detectAiTrainingEnvironment",
  "Files",
  "Git",
  "layerOtlp",
  "Linter",
  "LintPartialFailures",
  "mapWithConcurrency",
  "MILLISECONDS_PER_SECOND",
  "MIN_SCAN_CONCURRENCY",
  "NodeResolver",
  "OxlintConcurrency",
  "OXLINT_NODE_REQUIREMENT",
  "OXLINT_RECOMMENDED_NODE_MAJOR",
  "OxlintSpawnSlots",
  "PerFileLintCacheEnabled",
  "Progress",
  "Project",
  "ProjectChecks",
  "Reporter",
  "resolveScanConcurrency",
  "runInspect",
  "SidecarLintCacheEnabled",
  "StagedFiles",
  "SupplyChain",
];
const RUNTIME_CAPABILITY_SET = new Set<string>(RUNTIME_CAPABILITIES);

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

const collectDirectRuntimeBindings = (filePath: string): string[] => {
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
    const isTypeOnlyDeclaration = ts.isImportDeclaration(statement)
      ? statement.importClause?.isTypeOnly === true
      : statement.isTypeOnly;
    if (isTypeOnlyDeclaration) return [];
    if (
      namedBindings === undefined ||
      ts.isNamespaceImport(namedBindings) ||
      ts.isNamespaceExport(namedBindings)
    ) {
      return [...RUNTIME_CAPABILITIES];
    }

    return namedBindings.elements.flatMap((element) => {
      if (element.isTypeOnly) return [];
      const importedName = (element.propertyName ?? element.name).text;
      return RUNTIME_CAPABILITY_SET.has(importedName) ? [importedName] : [];
    });
  });
};

describe("React Doctor core runtime boundary", () => {
  it("routes every production runtime capability through one adapter", () => {
    const directDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      const importedCapabilities = collectDirectRuntimeBindings(filePath);
      if (importedCapabilities.length === 0) return [];

      return [
        `${path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")}: ${importedCapabilities.join(", ")}`,
      ];
    });

    expect(directDependents).toEqual([
      `${CORE_RUNTIME_RELATIVE_PATH}: ${RUNTIME_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes the adapter's runtime capability set and identities", () => {
    expect(Object.keys(coreRuntime).sort()).toEqual([...RUNTIME_CAPABILITIES].sort());
    expect(coreRuntime).toMatchObject({
      Config: core.Config,
      createOxlintSpawnSlots: core.createOxlintSpawnSlots,
      DeadCode: core.DeadCode,
      DEFAULT_PROJECT_SCAN_CONCURRENCY: core.DEFAULT_PROJECT_SCAN_CONCURRENCY,
      detectAiTrainingEnvironment: core.detectAiTrainingEnvironment,
      Files: core.Files,
      Git: core.Git,
      layerOtlp: core.layerOtlp,
      Linter: core.Linter,
      LintPartialFailures: core.LintPartialFailures,
      mapWithConcurrency: core.mapWithConcurrency,
      MILLISECONDS_PER_SECOND: core.MILLISECONDS_PER_SECOND,
      MIN_SCAN_CONCURRENCY: core.MIN_SCAN_CONCURRENCY,
      NodeResolver: core.NodeResolver,
      OxlintConcurrency: core.OxlintConcurrency,
      OXLINT_NODE_REQUIREMENT: core.OXLINT_NODE_REQUIREMENT,
      OXLINT_RECOMMENDED_NODE_MAJOR: core.OXLINT_RECOMMENDED_NODE_MAJOR,
      OxlintSpawnSlots: core.OxlintSpawnSlots,
      PerFileLintCacheEnabled: core.PerFileLintCacheEnabled,
      Progress: core.Progress,
      Project: core.Project,
      ProjectChecks: core.ProjectChecks,
      Reporter: core.Reporter,
      resolveScanConcurrency: core.resolveScanConcurrency,
      runInspect: core.runInspect,
      SidecarLintCacheEnabled: core.SidecarLintCacheEnabled,
      StagedFiles: core.StagedFiles,
      SupplyChain: core.SupplyChain,
    });
  });
});
