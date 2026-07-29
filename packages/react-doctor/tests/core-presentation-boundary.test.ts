import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODE_FRAME_BATCH_MAX_SPAN_LINES,
  CODE_FRAME_LINES_ABOVE,
  CODE_FRAME_LINES_BELOW,
  CODE_FRAME_MAX_LINE_LENGTH_CHARS,
  createNodeReadFileLinesSync,
  getCategoryImpact,
  hasPublishedFixRecipe,
  highlighter,
  MIGRATION_SCALE_RULE_FILE_COUNT,
  MIN_SHARED_FIX_SITE_COUNT,
  OUTPUT_MEASURE_WIDTH_CHARS,
  SCORE_BAR_WIDTH_CHARS,
  setColorEnabled,
  SPINNER_INDENT_CHARS,
} from "@react-doctor/core";
import * as corePresentation from "../src/core/core-presentation.js";
import * as ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_PRESENTATION_RELATIVE_PATH = "core/core-presentation.ts";
const CORE_PACKAGE_SPECIFIER = "@react-doctor/core";
const PRESENTATION_CAPABILITIES = [
  "CODE_FRAME_BATCH_MAX_SPAN_LINES",
  "CODE_FRAME_LINES_ABOVE",
  "CODE_FRAME_LINES_BELOW",
  "CODE_FRAME_MAX_LINE_LENGTH_CHARS",
  "createNodeReadFileLinesSync",
  "getCategoryImpact",
  "hasPublishedFixRecipe",
  "highlighter",
  "MIGRATION_SCALE_RULE_FILE_COUNT",
  "MIN_SHARED_FIX_SITE_COUNT",
  "OUTPUT_MEASURE_WIDTH_CHARS",
  "SCORE_BAR_WIDTH_CHARS",
  "setColorEnabled",
  "SPINNER_INDENT_CHARS",
] as const;
const PRESENTATION_CAPABILITY_SET = new Set<string>(PRESENTATION_CAPABILITIES);

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

const collectDirectPresentationBindings = (filePath: string): string[] => {
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
      return [...PRESENTATION_CAPABILITIES];
    }

    return namedBindings.elements.flatMap((element) => {
      const importedName = (element.propertyName ?? element.name).text;
      return PRESENTATION_CAPABILITY_SET.has(importedName) ? [importedName] : [];
    });
  });
};

describe("React Doctor core presentation boundary", () => {
  it("routes every production presentation capability through one adapter", () => {
    const directDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      const importedCapabilities = collectDirectPresentationBindings(filePath);
      if (importedCapabilities.length === 0) return [];

      return [
        `${path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")}: ${importedCapabilities.join(", ")}`,
      ];
    });

    expect(directDependents).toEqual([
      `${CORE_PRESENTATION_RELATIVE_PATH}: ${PRESENTATION_CAPABILITIES.join(", ")}`,
    ]);
  });

  it("freezes the adapter's runtime capability set and identities", () => {
    expect(Object.keys(corePresentation).sort()).toEqual([...PRESENTATION_CAPABILITIES].sort());
    expect(corePresentation.CODE_FRAME_BATCH_MAX_SPAN_LINES).toBe(CODE_FRAME_BATCH_MAX_SPAN_LINES);
    expect(corePresentation.CODE_FRAME_LINES_ABOVE).toBe(CODE_FRAME_LINES_ABOVE);
    expect(corePresentation.CODE_FRAME_LINES_BELOW).toBe(CODE_FRAME_LINES_BELOW);
    expect(corePresentation.CODE_FRAME_MAX_LINE_LENGTH_CHARS).toBe(
      CODE_FRAME_MAX_LINE_LENGTH_CHARS,
    );
    expect(corePresentation.createNodeReadFileLinesSync).toBe(createNodeReadFileLinesSync);
    expect(corePresentation.getCategoryImpact).toBe(getCategoryImpact);
    expect(corePresentation.hasPublishedFixRecipe).toBe(hasPublishedFixRecipe);
    expect(corePresentation.highlighter).toBe(highlighter);
    expect(corePresentation.MIGRATION_SCALE_RULE_FILE_COUNT).toBe(MIGRATION_SCALE_RULE_FILE_COUNT);
    expect(corePresentation.MIN_SHARED_FIX_SITE_COUNT).toBe(MIN_SHARED_FIX_SITE_COUNT);
    expect(corePresentation.OUTPUT_MEASURE_WIDTH_CHARS).toBe(OUTPUT_MEASURE_WIDTH_CHARS);
    expect(corePresentation.SCORE_BAR_WIDTH_CHARS).toBe(SCORE_BAR_WIDTH_CHARS);
    expect(corePresentation.setColorEnabled).toBe(setColorEnabled);
    expect(corePresentation.SPINNER_INDENT_CHARS).toBe(SPINNER_INDENT_CHARS);
  });
});
