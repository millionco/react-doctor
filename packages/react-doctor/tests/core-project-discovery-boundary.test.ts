import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@react-doctor/core";
import * as coreProjectDiscovery from "../src/core/core-project-discovery.js";
import * as ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_PROJECT_DISCOVERY_RELATIVE_PATH = "core/core-project-discovery.ts";
const CORE_PACKAGE_SPECIFIER = "@react-doctor/core";
const PROJECT_DISCOVERY_CAPABILITIES = [
  "buildPackageGraph",
  "discoverReactSubprojects",
  "filterSourceFiles",
  "hasReactRuntime",
  "HTML_FILE_PATTERN",
  "isDirectory",
  "isFile",
  "isMonorepoRoot",
  "JSX_FILE_PATTERN",
  "listSourceFiles",
  "readPackageJson",
  "resolveScanTarget",
] as const;
const PROJECT_DISCOVERY_CAPABILITY_SET = new Set<string>(PROJECT_DISCOVERY_CAPABILITIES);

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

const collectDirectProjectDiscoveryBindings = (filePath: string): string[] => {
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
      return [...PROJECT_DISCOVERY_CAPABILITIES];
    }

    return namedBindings.elements.flatMap((element) => {
      const importedName = (element.propertyName ?? element.name).text;
      return PROJECT_DISCOVERY_CAPABILITY_SET.has(importedName) ? [importedName] : [];
    });
  });
};

describe("React Doctor core project discovery boundary", () => {
  it("routes every production project discovery capability through one adapter", () => {
    const directDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      const importedCapabilities = collectDirectProjectDiscoveryBindings(filePath);
      if (importedCapabilities.length === 0) return [];

      return [
        `${path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")}: ${importedCapabilities.join(", ")}`,
      ];
    });

    expect(directDependents).toEqual([
      `${CORE_PROJECT_DISCOVERY_RELATIVE_PATH}: ${PROJECT_DISCOVERY_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes the adapter's runtime capability set and identities", () => {
    expect(Object.keys(coreProjectDiscovery).sort()).toEqual(
      [...PROJECT_DISCOVERY_CAPABILITIES].sort(),
    );
    expect(coreProjectDiscovery).toMatchObject({
      buildPackageGraph: core.buildPackageGraph,
      discoverReactSubprojects: core.discoverReactSubprojects,
      filterSourceFiles: core.filterSourceFiles,
      hasReactRuntime: core.hasReactRuntime,
      HTML_FILE_PATTERN: core.HTML_FILE_PATTERN,
      isDirectory: core.isDirectory,
      isFile: core.isFile,
      isMonorepoRoot: core.isMonorepoRoot,
      JSX_FILE_PATTERN: core.JSX_FILE_PATTERN,
      listSourceFiles: core.listSourceFiles,
      readPackageJson: core.readPackageJson,
      resolveScanTarget: core.resolveScanTarget,
    });
  });
});
