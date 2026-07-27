import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@react-doctor/core";
import * as corePrimitives from "../src/core/core-primitives.js";
import * as coreProduct from "../src/core/core-product.js";
import * as ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_PACKAGE_SPECIFIER = "@react-doctor/core";
const PRIMITIVE_CAPABILITIES: ReadonlyArray<string> = [
  "isPlainObject",
  "redactSensitiveText",
  "scrubSensitivePaths",
  "toRelativePath",
];
const PRODUCT_CAPABILITIES: ReadonlyArray<string> = [
  "buildRuleDocsUrl",
  "CANONICAL_DISCORD_URL",
  "CANONICAL_GITHUB_URL",
  "CI_URL",
  "CONFIG_SCHEMA_URL",
  "DOCS_URL",
  "ENTERPRISE_CONTACT_URL",
  "GITHUB_ACTIONS_SETUP_URL",
  "SHARE_BASE_URL",
  "SKILL_NAME",
];

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

describe("React Doctor core shared boundaries", () => {
  it("routes product metadata through its private adapter", () => {
    expect(collectDirectDependents(PRODUCT_CAPABILITIES)).toEqual([
      `core/core-product.ts: ${PRODUCT_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes the product exports and identities", () => {
    expect(Object.keys(coreProduct).sort()).toEqual([...PRODUCT_CAPABILITIES].sort());
    expect(coreProduct).toMatchObject({
      buildRuleDocsUrl: core.buildRuleDocsUrl,
      CANONICAL_DISCORD_URL: core.CANONICAL_DISCORD_URL,
      CANONICAL_GITHUB_URL: core.CANONICAL_GITHUB_URL,
      CI_URL: core.CI_URL,
      CONFIG_SCHEMA_URL: core.CONFIG_SCHEMA_URL,
      DOCS_URL: core.DOCS_URL,
      ENTERPRISE_CONTACT_URL: core.ENTERPRISE_CONTACT_URL,
      GITHUB_ACTIONS_SETUP_URL: core.GITHUB_ACTIONS_SETUP_URL,
      SHARE_BASE_URL: core.SHARE_BASE_URL,
      SKILL_NAME: core.SKILL_NAME,
    });
  });

  it("routes generic primitives through their private adapter", () => {
    expect(collectDirectDependents(PRIMITIVE_CAPABILITIES)).toEqual([
      `core/core-primitives.ts: ${PRIMITIVE_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes the primitive exports and identities", () => {
    expect(Object.keys(corePrimitives).sort()).toEqual([...PRIMITIVE_CAPABILITIES].sort());
    expect(corePrimitives).toMatchObject({
      isPlainObject: core.isPlainObject,
      redactSensitiveText: core.redactSensitiveText,
      scrubSensitivePaths: core.scrubSensitivePaths,
      toRelativePath: core.toRelativePath,
    });
  });
});
