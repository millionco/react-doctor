import fs from "node:fs";
import path from "node:path";
import { main } from "knip";
import { createOptions } from "knip/session";
import { MAX_KNIP_RETRIES } from "../constants.js";
import type { Diagnostic, KnipIssueRecords, KnipResults } from "../types.js";
import { findMonorepoRoot } from "./find-monorepo-root.js";

const KNIP_CATEGORY_MAP: Record<string, string> = {
  files: "Dead Code",
  exports: "Dead Code",
  types: "Dead Code",
  duplicates: "Dead Code",
};

const KNIP_MESSAGE_MAP: Record<string, string> = {
  files: "Unused file",
  exports: "Unused export",
  types: "Unused type",
  duplicates: "Duplicate export",
};

const KNIP_SEVERITY_MAP: Record<string, "error" | "warning"> = {
  files: "warning",
  exports: "warning",
  types: "warning",
  duplicates: "warning",
};

const collectIssueRecords = (
  records: KnipIssueRecords,
  issueType: string,
  rootDirectory: string,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  for (const issues of Object.values(records)) {
    for (const issue of Object.values(issues)) {
      diagnostics.push({
        filePath: path.relative(rootDirectory, issue.filePath),
        plugin: "knip",
        rule: issueType,
        severity: KNIP_SEVERITY_MAP[issueType] ?? "warning",
        message: `${KNIP_MESSAGE_MAP[issueType]}: ${issue.symbol}`,
        help: "",
        line: 0,
        column: 0,
        category: KNIP_CATEGORY_MAP[issueType] ?? "Dead Code",
        weight: 1,
      });
    }
  }

  return diagnostics;
};

// HACK: knip triggers dotenv which logs to stdout/stderr via console methods
const silenced = async <T>(fn: () => Promise<T>): Promise<T> => {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  }
};

const CONFIG_LOADING_ERROR_PATTERN = /Error loading .*\/([a-z-]+)\.config\./;

const extractFailedPluginName = (error: unknown): string | null => {
  const match = String(error).match(CONFIG_LOADING_ERROR_PATTERN);
  return match?.[1] ?? null;
};

const TSCONFIG_FILENAMES = ["tsconfig.base.json", "tsconfig.json"];

const resolveTsConfigFile = (directory: string): string | undefined =>
  TSCONFIG_FILENAMES.find((filename) => fs.existsSync(path.join(directory, filename)));

const runKnipWithOptions = async (
  knipCwd: string,
  workspaceName?: string,
): Promise<KnipResults> => {
  const tsConfigFile = resolveTsConfigFile(knipCwd);
  const options = await silenced(() =>
    createOptions({
      cwd: knipCwd,
      isShowProgress: false,
      ...(workspaceName ? { workspace: workspaceName } : {}),
      ...(tsConfigFile ? { tsConfigFile } : {}),
    }),
  );

  const parsedConfig = options.parsedConfig as Record<string, unknown>;

  for (let attempt = 0; attempt <= MAX_KNIP_RETRIES; attempt++) {
    try {
      return (await silenced(() => main(options))) as KnipResults;
    } catch (error) {
      const failedPlugin = extractFailedPluginName(error);
      if (!failedPlugin || attempt === MAX_KNIP_RETRIES) {
        throw error;
      }
      parsedConfig[failedPlugin] = false;
    }
  }

  throw new Error("Unreachable");
};

const hasNodeModules = (directory: string): boolean => {
  const nodeModulesPath = path.join(directory, "node_modules");
  return fs.existsSync(nodeModulesPath) && fs.statSync(nodeModulesPath).isDirectory();
};

export const runKnip = async (rootDirectory: string): Promise<Diagnostic[]> => {
  const monorepoRoot = findMonorepoRoot(rootDirectory);
  const hasInstalledDependencies =
    hasNodeModules(rootDirectory) || (monorepoRoot !== null && hasNodeModules(monorepoRoot));

  if (!hasInstalledDependencies) {
    return [];
  }

  let knipResult: KnipResults;

  if (monorepoRoot) {
    const packageJsonPath = path.join(rootDirectory, "package.json");
    const packageJson = fs.existsSync(packageJsonPath)
      ? JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
      : {};
    const workspaceName = packageJson.name ?? path.basename(rootDirectory);

    try {
      knipResult = await runKnipWithOptions(monorepoRoot, workspaceName);
    } catch {
      knipResult = await runKnipWithOptions(rootDirectory);
    }
  } else {
    knipResult = await runKnipWithOptions(rootDirectory);
  }

  const { issues } = knipResult;
  const diagnostics: Diagnostic[] = [];

  for (const unusedFile of issues.files) {
    diagnostics.push({
      filePath: path.relative(rootDirectory, unusedFile),
      plugin: "knip",
      rule: "files",
      severity: KNIP_SEVERITY_MAP["files"],
      message: KNIP_MESSAGE_MAP["files"],
      help: "This file is not imported by any other file in the project.",
      line: 0,
      column: 0,
      category: KNIP_CATEGORY_MAP["files"],
      weight: 1,
    });
  }

  const recordTypes = ["exports", "types", "duplicates"] as const;

  for (const issueType of recordTypes) {
    diagnostics.push(...collectIssueRecords(issues[issueType], issueType, rootDirectory));
  }

  return diagnostics;
};
