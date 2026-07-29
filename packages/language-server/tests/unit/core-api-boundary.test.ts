import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import * as coreApi from "../../src/core/core-api.js";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../../src", import.meta.url));
const CORE_API_RELATIVE_PATH = "core/core-api.ts";
const CORE_PACKAGE_SPECIFIER_PATTERN = /["']@react-doctor\/core(?:\/[^"']*)?["']/;

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

describe("language-server core API boundary", () => {
  it("routes every production core package dependency through one local facade", () => {
    const directCoreDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      const sourceText = fs.readFileSync(filePath, "utf8");
      return CORE_PACKAGE_SPECIFIER_PATTERN.test(sourceText)
        ? [path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")]
        : [];
    });

    expect(directCoreDependents).toEqual([CORE_API_RELATIVE_PATH]);
  });

  it("keeps the runtime facade limited to the language server's owned capabilities", () => {
    expect(Object.keys(coreApi).sort()).toEqual(
      [
        "ADOPTABLE_LINT_CONFIG_FILENAMES",
        "buildDiagnosticIdentity",
        "clearCoreCaches",
        "computeConfigFingerprint",
        "CONFIG_FINGERPRINT_FILENAMES",
        "discoverReactSubprojects",
        "getRuleMetadata",
        "hashFileContents",
        "listSourceFiles",
        "messageFromUnknown",
        "resolveNodeForOxlint",
        "runEditorScan",
        "STAGED_FILES_PROJECT_CONFIG_FILENAMES",
      ].sort(),
    );
  });
});
