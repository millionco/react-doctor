import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@react-doctor/core";
import * as coreConfiguration from "../src/core/core-configuration.js";
import * as reactDoctorApi from "../src/index.js";
import * as ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_CONFIGURATION_RELATIVE_PATH = "core/core-configuration.ts";
const CORE_PACKAGE_SPECIFIER = "@react-doctor/core";
const CONFIGURATION_RUNTIME_CAPABILITIES = [
  "clearConfigCache",
  "COMPILER_CLEANUP_BUCKET",
  "COMPILER_CLEANUP_RULE_KEYS",
  "DEFAULT_SHOW_WARNINGS",
  "defineConfig",
  "findLegacyConfig",
  "LEGACY_CONFIG_FILENAME",
  "loadConfigWithSource",
  "mergeReactDoctorConfigs",
  "validateConfigTypes",
] as const;
const CONFIGURATION_TYPE_CAPABILITIES = ["ReactDoctorConfig", "RuleSeverityOverride"] as const;
const CONFIGURATION_CAPABILITIES = [
  ...CONFIGURATION_RUNTIME_CAPABILITIES,
  ...CONFIGURATION_TYPE_CAPABILITIES,
] as const;
const CONFIGURATION_CAPABILITY_SET = new Set<string>(CONFIGURATION_CAPABILITIES);

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

const collectDirectConfigurationBindings = (filePath: string): string[] => {
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
      return [...CONFIGURATION_CAPABILITIES];
    }

    return namedBindings.elements.flatMap((element) => {
      const importedName = (element.propertyName ?? element.name).text;
      return CONFIGURATION_CAPABILITY_SET.has(importedName) ? [importedName] : [];
    });
  });
};

describe("React Doctor core configuration boundary", () => {
  it("routes every production configuration capability through one adapter", () => {
    const directDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      const importedCapabilities = collectDirectConfigurationBindings(filePath);
      if (importedCapabilities.length === 0) return [];

      return [
        `${path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")}: ${importedCapabilities.join(", ")}`,
      ];
    });

    expect(directDependents).toEqual([
      `${CORE_CONFIGURATION_RELATIVE_PATH}: ${CONFIGURATION_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes the adapter's runtime capability set and identities", () => {
    expect(Object.keys(coreConfiguration).sort()).toEqual(
      [...CONFIGURATION_RUNTIME_CAPABILITIES].sort(),
    );
    expect(coreConfiguration).toMatchObject({
      clearConfigCache: core.clearConfigCache,
      COMPILER_CLEANUP_BUCKET: core.COMPILER_CLEANUP_BUCKET,
      COMPILER_CLEANUP_RULE_KEYS: core.COMPILER_CLEANUP_RULE_KEYS,
      DEFAULT_SHOW_WARNINGS: core.DEFAULT_SHOW_WARNINGS,
      defineConfig: core.defineConfig,
      findLegacyConfig: core.findLegacyConfig,
      LEGACY_CONFIG_FILENAME: core.LEGACY_CONFIG_FILENAME,
      loadConfigWithSource: core.loadConfigWithSource,
      mergeReactDoctorConfigs: core.mergeReactDoctorConfigs,
      validateConfigTypes: core.validateConfigTypes,
    });
  });

  it("freezes the adapter's type capability set", () => {
    const adapterPath = path.join(SOURCE_DIRECTORY, CORE_CONFIGURATION_RELATIVE_PATH);
    const sourceFile = ts.createSourceFile(
      adapterPath,
      fs.readFileSync(adapterPath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const exportedTypes = sourceFile.statements.flatMap((statement) =>
      ts.isExportDeclaration(statement) &&
      statement.isTypeOnly &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.map((element) => element.name.text)
        : [],
    );

    expect(exportedTypes.sort()).toEqual([...CONFIGURATION_TYPE_CAPABILITIES].sort());
  });

  it("preserves the public defineConfig facade identity", () => {
    expect(reactDoctorApi.defineConfig).toBe(core.defineConfig);
  });
});
