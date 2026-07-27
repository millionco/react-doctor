import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@react-doctor/core";
import * as coreScanCache from "../src/core/core-scan-cache.js";
import * as coreVersionControl from "../src/core/core-version-control.js";
import * as reactDoctorApi from "../src/index.js";
import * as ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_PACKAGE_SPECIFIER = "@react-doctor/core";
const VERSION_CONTROL_CAPABILITIES = [
  "getBaselineDiffPlan",
  "getChangedLineRanges",
  "getDiffInfo",
  "GIT_SHOW_MAX_BUFFER_BYTES",
  "materializeSourceTree",
  "STAGED_FILES_PROJECT_CONFIG_FILENAMES",
] as const;
const SCAN_CACHE_CAPABILITIES = [
  "clearCoreCaches",
  "computeConfigFingerprint",
  "hashFileContents",
  "resolveLintBatchOrdering",
  "resolveReactDoctorCacheDir",
] as const;

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

const collectDirectBindings = (filePath: string, capabilities: ReadonlyArray<string>): string[] => {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const capabilitySet = new Set<string>(capabilities);

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
      return [...capabilities];
    }

    return namedBindings.elements.flatMap((element) => {
      const importedName = (element.propertyName ?? element.name).text;
      return capabilitySet.has(importedName) ? [importedName] : [];
    });
  });
};

const collectDirectDependents = (capabilities: ReadonlyArray<string>): string[] =>
  collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
    const importedCapabilities = collectDirectBindings(filePath, capabilities);
    if (importedCapabilities.length === 0) return [];

    return [
      `${path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")}: ${importedCapabilities.join(", ")}`,
    ];
  });

describe("React Doctor core source boundaries", () => {
  it("routes version-control capabilities through their private adapter", () => {
    expect(collectDirectDependents(VERSION_CONTROL_CAPABILITIES)).toEqual([
      `core/core-version-control.ts: ${VERSION_CONTROL_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes version-control exports and identities", () => {
    expect(Object.keys(coreVersionControl).sort()).toEqual(
      [...VERSION_CONTROL_CAPABILITIES].sort(),
    );
    expect(coreVersionControl).toMatchObject({
      getBaselineDiffPlan: core.getBaselineDiffPlan,
      getChangedLineRanges: core.getChangedLineRanges,
      getDiffInfo: core.getDiffInfo,
      GIT_SHOW_MAX_BUFFER_BYTES: core.GIT_SHOW_MAX_BUFFER_BYTES,
      materializeSourceTree: core.materializeSourceTree,
      STAGED_FILES_PROJECT_CONFIG_FILENAMES: core.STAGED_FILES_PROJECT_CONFIG_FILENAMES,
    });
  });

  it("preserves the public getDiffInfo facade identity", () => {
    expect(reactDoctorApi.getDiffInfo).toBe(core.getDiffInfo);
  });

  it("routes scan-cache capabilities through their private adapter", () => {
    expect(collectDirectDependents(SCAN_CACHE_CAPABILITIES)).toEqual([
      `core/core-scan-cache.ts: ${SCAN_CACHE_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes scan-cache exports and identities", () => {
    expect(Object.keys(coreScanCache).sort()).toEqual([...SCAN_CACHE_CAPABILITIES].sort());
    expect(coreScanCache).toMatchObject({
      clearCoreCaches: core.clearCoreCaches,
      computeConfigFingerprint: core.computeConfigFingerprint,
      hashFileContents: core.hashFileContents,
      resolveLintBatchOrdering: core.resolveLintBatchOrdering,
      resolveReactDoctorCacheDir: core.resolveReactDoctorCacheDir,
    });
  });
});
