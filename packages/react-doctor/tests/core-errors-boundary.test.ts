import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@react-doctor/core";
import * as coreErrors from "../src/core/core-errors.js";
import * as reactDoctorApi from "../src/index.js";
import * as ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_ERRORS_RELATIVE_PATH = "core/core-errors.ts";
const CORE_PACKAGE_SPECIFIER = "@react-doctor/core";
const ERROR_CAPABILITIES = [
  "AmbiguousProjectError",
  "formatErrorChain",
  "formatReactDoctorError",
  "isErrnoException",
  "isProjectDiscoveryError",
  "isReactDoctorError",
  "messageFromUnknown",
  "NoReactDependencyError",
  "NotADirectoryError",
  "PackageJsonNotFoundError",
  "ProjectNotFoundError",
  "ReactDoctorError",
  "restoreLegacyThrow",
] as const;
const ERROR_CAPABILITY_SET = new Set<string>(ERROR_CAPABILITIES);

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

const collectDirectErrorBindings = (filePath: string): string[] => {
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
      return [...ERROR_CAPABILITIES];
    }

    return namedBindings.elements.flatMap((element) => {
      const importedName = (element.propertyName ?? element.name).text;
      return ERROR_CAPABILITY_SET.has(importedName) ? [importedName] : [];
    });
  });
};

describe("React Doctor core errors boundary", () => {
  it("routes every production error capability through one adapter", () => {
    const directDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      const importedCapabilities = collectDirectErrorBindings(filePath);
      if (importedCapabilities.length === 0) return [];

      return [
        `${path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")}: ${importedCapabilities.join(", ")}`,
      ];
    });

    expect(directDependents).toEqual([
      `${CORE_ERRORS_RELATIVE_PATH}: ${ERROR_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes the adapter's runtime capability set and identities", () => {
    expect(Object.keys(coreErrors).sort()).toEqual([...ERROR_CAPABILITIES].sort());
    expect(coreErrors).toMatchObject({
      AmbiguousProjectError: core.AmbiguousProjectError,
      formatErrorChain: core.formatErrorChain,
      formatReactDoctorError: core.formatReactDoctorError,
      isErrnoException: core.isErrnoException,
      isProjectDiscoveryError: core.isProjectDiscoveryError,
      isReactDoctorError: core.isReactDoctorError,
      messageFromUnknown: core.messageFromUnknown,
      NoReactDependencyError: core.NoReactDependencyError,
      NotADirectoryError: core.NotADirectoryError,
      PackageJsonNotFoundError: core.PackageJsonNotFoundError,
      ProjectNotFoundError: core.ProjectNotFoundError,
      ReactDoctorError: core.ReactDoctorError,
      restoreLegacyThrow: core.restoreLegacyThrow,
    });
  });

  it("preserves the public error facade identities", () => {
    expect(reactDoctorApi).toMatchObject({
      AmbiguousProjectError: core.AmbiguousProjectError,
      isProjectDiscoveryError: core.isProjectDiscoveryError,
      isReactDoctorError: core.isReactDoctorError,
      NoReactDependencyError: core.NoReactDependencyError,
      NotADirectoryError: core.NotADirectoryError,
      PackageJsonNotFoundError: core.PackageJsonNotFoundError,
      ProjectNotFoundError: core.ProjectNotFoundError,
      ReactDoctorError: core.ReactDoctorError,
    });
  });
});
