import fs from "node:fs";
import path from "node:path";
import { main } from "knip";
import { createOptions } from "knip/session";
import { KNIP_TOTAL_ATTEMPTS } from "../constants.js";
import type { Diagnostic, KnipIssueRecords, KnipResults } from "../types.js";
import { collectUnusedFilePaths } from "./collect-unused-file-paths.js";
import { extractFailedPluginName } from "./extract-failed-plugin-name.js";
import { findMonorepoRoot } from "./find-monorepo-root.js";
import { hasKnipConfig } from "./has-knip-config.js";
import { isFile } from "./is-file.js";
import { readPackageJson } from "./read-package-json.js";

interface KnipIssueDescriptor {
  category: string;
  message: string;
  severity: "error" | "warning";
}

const KNIP_ISSUE_TYPE_DESCRIPTORS: Record<string, KnipIssueDescriptor> = {
  files: { category: "Dead Code", message: "Unused file", severity: "warning" },
  exports: { category: "Dead Code", message: "Unused export", severity: "warning" },
  types: { category: "Dead Code", message: "Unused type", severity: "warning" },
  duplicates: { category: "Dead Code", message: "Duplicate export", severity: "warning" },
};

const FALLBACK_KNIP_DESCRIPTOR: KnipIssueDescriptor = {
  category: "Dead Code",
  message: "Issue",
  severity: "warning",
};

const collectIssueRecords = (
  records: KnipIssueRecords,
  issueType: string,
  rootDirectory: string,
): Diagnostic[] => {
  const descriptor = KNIP_ISSUE_TYPE_DESCRIPTORS[issueType] ?? FALLBACK_KNIP_DESCRIPTOR;
  const diagnostics: Diagnostic[] = [];

  for (const issues of Object.values(records)) {
    for (const issue of Object.values(issues)) {
      diagnostics.push({
        filePath: path.relative(rootDirectory, issue.filePath),
        plugin: "knip",
        rule: issueType,
        severity: descriptor.severity,
        message: `${descriptor.message}: ${issue.symbol}`,
        help: "",
        line: 0,
        column: 0,
        category: descriptor.category,
      });
    }
  }

  return diagnostics;
};

// HACK: knip triggers dotenv and its plugin loaders, which print directly to
// console.* methods that we don't control. We hijack console for the duration
// of the knip call so its noise doesn't pollute our spinner-aware output.
// Concurrent code paths in the scan pipeline (oxlint, ora, fetch) bypass
// console entirely, so the global swap is safe in practice.
const silenced = async <T>(fn: () => Promise<T>): Promise<T> => {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;

  const noop = (): void => {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  }
};

const TSCONFIG_FILENAMES = ["tsconfig.base.json", "tsconfig.json"];

const resolveTsConfigFile = (directory: string): string | undefined =>
  TSCONFIG_FILENAMES.find((filename) => fs.existsSync(path.join(directory, filename)));

const tryDisableFailedPlugin = (
  error: unknown,
  parsedConfig: Record<string, unknown>,
  disabledPlugins: Set<string>,
): boolean => {
  const failedPlugin = extractFailedPluginName(error);
  if (!failedPlugin || !(failedPlugin in parsedConfig) || disabledPlugins.has(failedPlugin)) {
    return false;
  }
  disabledPlugins.add(failedPlugin);
  parsedConfig[failedPlugin] = false;
  return true;
};

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
  const disabledPlugins = new Set<string>();
  let lastKnipError: unknown;

  for (let attempt = 0; attempt < KNIP_TOTAL_ATTEMPTS; attempt++) {
    try {
      return (await silenced(() => main(options))) as KnipResults;
    } catch (error) {
      lastKnipError = error;
      if (!tryDisableFailedPlugin(error, parsedConfig, disabledPlugins)) {
        throw error;
      }
    }
  }

  throw lastKnipError;
};

const hasNodeModules = (directory: string): boolean => {
  const nodeModulesPath = path.join(directory, "node_modules");
  return fs.existsSync(nodeModulesPath) && fs.statSync(nodeModulesPath).isDirectory();
};

const resolveWorkspaceName = (rootDirectory: string): string => {
  const packageJsonPath = path.join(rootDirectory, "package.json");
  const packageJson = isFile(packageJsonPath) ? readPackageJson(packageJsonPath) : {};
  return packageJson.name ?? path.basename(rootDirectory);
};

// HACK: knip ignores workspace-local config when run from the monorepo root with
// --workspace, so prefer the workspace cwd when it owns its config (issue #136).
const runKnipForProject = async (
  rootDirectory: string,
  monorepoRoot: string | null,
): Promise<KnipResults> => {
  if (!monorepoRoot || hasKnipConfig(rootDirectory)) {
    return runKnipWithOptions(rootDirectory);
  }
  try {
    return await runKnipWithOptions(monorepoRoot, resolveWorkspaceName(rootDirectory));
  } catch {
    return runKnipWithOptions(rootDirectory);
  }
};

export const runKnip = async (rootDirectory: string): Promise<Diagnostic[]> => {
  const monorepoRoot = findMonorepoRoot(rootDirectory);
  const hasInstalledDependencies =
    hasNodeModules(rootDirectory) || (monorepoRoot !== null && hasNodeModules(monorepoRoot));

  if (!hasInstalledDependencies) {
    return [];
  }

  const knipResult = await runKnipForProject(rootDirectory, monorepoRoot);

  const { issues } = knipResult;
  const diagnostics: Diagnostic[] = [];

  const filesDescriptor = KNIP_ISSUE_TYPE_DESCRIPTORS.files;
  for (const unusedFilePath of collectUnusedFilePaths(issues.files)) {
    diagnostics.push({
      filePath: path.relative(rootDirectory, unusedFilePath),
      plugin: "knip",
      rule: "files",
      severity: filesDescriptor.severity,
      message: filesDescriptor.message,
      help: "This file is not imported by any other file in the project.",
      line: 0,
      column: 0,
      category: filesDescriptor.category,
    });
  }

  const recordTypes = ["exports", "types", "duplicates"] as const;

  for (const issueType of recordTypes) {
    diagnostics.push(...collectIssueRecords(issues[issueType], issueType, rootDirectory));
  }

  return diagnostics;
};
