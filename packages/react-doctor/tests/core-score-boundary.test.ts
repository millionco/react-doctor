import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@react-doctor/core";
import * as coreScore from "../src/core/core-score.js";
import * as ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_SCORE_RELATIVE_PATH = "core/core-score.ts";
const CORE_PACKAGE_SPECIFIER = "@react-doctor/core";
const SCORE_CAPABILITIES = [
  "calculateScore",
  "PERFECT_SCORE",
  "resolveGithubActionsScoreMetadata",
  "SCORE_GOOD_THRESHOLD",
  "SCORE_OK_THRESHOLD",
  "Score",
  "TOP_ERRORS_DISPLAY_COUNT",
] as const;
const SCORE_CAPABILITY_SET = new Set<string>(SCORE_CAPABILITIES);

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

const collectDirectScoreBindings = (filePath: string): string[] => {
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
      return [...SCORE_CAPABILITIES];
    }

    return namedBindings.elements.flatMap((element) => {
      const importedName = (element.propertyName ?? element.name).text;
      return SCORE_CAPABILITY_SET.has(importedName) ? [importedName] : [];
    });
  });
};

describe("React Doctor core score boundary", () => {
  it("routes every production score capability through one adapter", () => {
    const directDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      const importedCapabilities = collectDirectScoreBindings(filePath);
      if (importedCapabilities.length === 0) return [];

      return [
        `${path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")}: ${importedCapabilities.join(", ")}`,
      ];
    });

    expect(directDependents).toEqual([
      `${CORE_SCORE_RELATIVE_PATH}: ${SCORE_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes the adapter's runtime capability set and identities", () => {
    expect(Object.keys(coreScore).sort()).toEqual([...SCORE_CAPABILITIES].sort());
    expect(coreScore).toMatchObject({
      calculateScore: core.calculateScore,
      PERFECT_SCORE: core.PERFECT_SCORE,
      resolveGithubActionsScoreMetadata: core.resolveGithubActionsScoreMetadata,
      SCORE_GOOD_THRESHOLD: core.SCORE_GOOD_THRESHOLD,
      SCORE_OK_THRESHOLD: core.SCORE_OK_THRESHOLD,
      Score: core.Score,
      TOP_ERRORS_DISPLAY_COUNT: core.TOP_ERRORS_DISPLAY_COUNT,
    });
  });
});
