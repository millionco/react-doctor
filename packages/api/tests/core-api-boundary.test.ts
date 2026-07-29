import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import * as corePackage from "@react-doctor/core";
import * as publicApi from "../src/index.js";
import * as coreApi from "../src/core-api.js";

const SOURCE_DIRECTORY = fileURLToPath(new URL("../src", import.meta.url));
const CORE_API_RELATIVE_PATH = "core-api.ts";
const CORE_PACKAGE_SPECIFIER_PATTERN = /["']@react-doctor\/core(?:\/[^"']*)?["']/;
const TYPE_EXPORT_PATTERN = /export type\s*\{([\s\S]*?)\}\s*from\s*["']@react-doctor\/core["']/;

const collectTypeScriptFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [entryPath]
      : [];
  });

describe("API core boundary", () => {
  it("routes every production core package dependency through one local facade", () => {
    const directCoreDependents = collectTypeScriptFiles(SOURCE_DIRECTORY).flatMap((filePath) => {
      const sourceText = fs.readFileSync(filePath, "utf8");
      return CORE_PACKAGE_SPECIFIER_PATTERN.test(sourceText)
        ? [path.relative(SOURCE_DIRECTORY, filePath).replaceAll(path.sep, "/")]
        : [];
    });

    expect(directCoreDependents).toEqual([CORE_API_RELATIVE_PATH]);
  });

  it("freezes the facade runtime and type capabilities", () => {
    expect(Object.keys(coreApi).sort()).toEqual(
      [
        "AmbiguousProjectError",
        "buildSkippedChecks",
        "Config",
        "createOxlintSpawnSlots",
        "DeadCode",
        "DEFAULT_PROJECT_SCAN_CONCURRENCY",
        "DEFAULT_SHOW_WARNINGS",
        "defineConfig",
        "detectAiTrainingEnvironment",
        "Files",
        "Git",
        "hasReactRuntime",
        "hasReactRuntime$1",
        "isReactDoctorError",
        "layerOtlp",
        "Linter",
        "LintPartialFailures",
        "mapWithConcurrency",
        "mergeReactDoctorConfigs",
        "NoReactDependencyError",
        "NotADirectoryError",
        "OxlintConcurrency",
        "OxlintSpawnSlots",
        "PackageJsonNotFoundError",
        "Progress",
        "Project",
        "ProjectChecks",
        "ProjectNotFoundError",
        "ReactDoctorError",
        "Reporter",
        "resolveScanTarget",
        "restoreLegacyThrow",
        "runInspect",
        "Score",
        "SupplyChain",
      ].sort(),
    );

    const facadeSource = fs.readFileSync(
      path.join(SOURCE_DIRECTORY, CORE_API_RELATIVE_PATH),
      "utf8",
    );
    const typeExportBindings = TYPE_EXPORT_PATTERN.exec(facadeSource)?.[1] ?? "";
    const typeCapabilities = typeExportBindings
      .split(",")
      .map((binding) => binding.trim())
      .filter((binding) => binding.length > 0)
      .sort();
    expect(typeCapabilities).toEqual(
      [
        "DiagnoseOptions",
        "DiagnoseOptions as DiagnoseOptions$1",
        "DiagnoseProjectsInput",
        "DiagnoseProjectsInput as DiagnoseProjectsInput$1",
        "DiagnoseProjectsResult",
        "DiagnoseProjectsResult as DiagnoseProjectsResult$1",
        "DiagnoseResult",
        "DiagnoseResult as DiagnoseResult$1",
        "Diagnostic",
        "InspectOutput",
        "ProjectDefinition",
        "ProjectInfo",
        "ProjectResult",
        "ProjectResultError",
        "ProjectResultOk",
        "ReactDoctorConfig",
        "ResolvedScanTarget",
        "ScoreResult",
        "WorkerSlots",
      ].sort(),
    );
  });

  it("preserves every public runtime re-export by identity", () => {
    expect({
      AmbiguousProjectError: publicApi.AmbiguousProjectError,
      defineConfig: publicApi.defineConfig,
      hasReactRuntime: publicApi.hasReactRuntime,
      isReactDoctorError: publicApi.isReactDoctorError,
      NoReactDependencyError: publicApi.NoReactDependencyError,
      NotADirectoryError: publicApi.NotADirectoryError,
      PackageJsonNotFoundError: publicApi.PackageJsonNotFoundError,
      ProjectNotFoundError: publicApi.ProjectNotFoundError,
      ReactDoctorError: publicApi.ReactDoctorError,
    }).toEqual({
      AmbiguousProjectError: corePackage.AmbiguousProjectError,
      defineConfig: corePackage.defineConfig,
      hasReactRuntime: corePackage.hasReactRuntime,
      isReactDoctorError: corePackage.isReactDoctorError,
      NoReactDependencyError: corePackage.NoReactDependencyError,
      NotADirectoryError: corePackage.NotADirectoryError,
      PackageJsonNotFoundError: corePackage.PackageJsonNotFoundError,
      ProjectNotFoundError: corePackage.ProjectNotFoundError,
      ReactDoctorError: corePackage.ReactDoctorError,
    });
    expect(coreApi.hasReactRuntime$1).toBe(corePackage.hasReactRuntime);
  });
});
