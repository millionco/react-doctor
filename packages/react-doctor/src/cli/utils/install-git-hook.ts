import * as path from "node:path";
import * as fs from "node:fs";
import {
  getPackageJsonPath,
  HOOK_FILE_NAME,
  HOOK_RELATIVE_PATH,
  HUSKY_HOOKS_PATH,
  isRecord,
  LEFTHOOK_CONFIG_FILES,
  OVERCOMMIT_CONFIG_FILE,
  packageHasDependency,
  packageHasNestedRecordKey,
  packageHasRecordKey,
  PRE_COMMIT_CONFIG_FILE,
  readPackageJson,
  resolveGitPath,
  runGit,
  SIMPLE_GIT_HOOKS_CONFIG_FILE,
  SIMPLE_GIT_HOOKS_PACKAGE_JSON_KEY,
  VITE_PLUS_HOOKS_PATH,
} from "./git-hook-shared.js";
import {
  GitHookKind,
  type GitHookTarget,
  type InstallGitHookOptions,
  type InstallGitHookResult,
} from "./git-hook-types.js";
import {
  installGhooks,
  installGitHooksJs,
  installLefthook,
  installOvercommit,
  installPreCommit,
  installPreCommitNpm,
  installPrettyQuick,
  installSimpleGitHooks,
  installYorkie,
} from "./install-git-hook-config-managers.js";
import { installDirectGitHook } from "./install-git-hook-file.js";

export type {
  GitHookTarget,
  InstallGitHookOptions,
  InstallGitHookResult,
} from "./git-hook-types.js";

const isHuskyProject = (projectRoot: string): boolean =>
  fs.existsSync(path.join(projectRoot, HUSKY_HOOKS_PATH)) ||
  packageHasDependency(projectRoot, "husky");

const isVitePlusProject = (projectRoot: string): boolean =>
  packageHasDependency(projectRoot, "vite-plus");

const isSimpleGitHooksProject = (projectRoot: string): boolean => {
  const packageJson = readPackageJson(projectRoot);
  return (
    (isRecord(packageJson) && isRecord(packageJson[SIMPLE_GIT_HOOKS_PACKAGE_JSON_KEY])) ||
    packageHasDependency(projectRoot, SIMPLE_GIT_HOOKS_PACKAGE_JSON_KEY) ||
    fs.existsSync(path.join(projectRoot, SIMPLE_GIT_HOOKS_CONFIG_FILE))
  );
};

const getLefthookConfigPath = (projectRoot: string): string | null => {
  for (const fileName of LEFTHOOK_CONFIG_FILES) {
    const filePath = path.join(projectRoot, fileName);
    if (fs.existsSync(filePath)) return filePath;
  }
  return packageHasDependency(projectRoot, "lefthook")
    ? path.join(projectRoot, LEFTHOOK_CONFIG_FILES[0] ?? "lefthook.yml")
    : null;
};

const isPreCommitProject = (projectRoot: string): boolean =>
  fs.existsSync(path.join(projectRoot, PRE_COMMIT_CONFIG_FILE));

const isOvercommitProject = (projectRoot: string): boolean =>
  fs.existsSync(path.join(projectRoot, OVERCOMMIT_CONFIG_FILE)) ||
  packageHasDependency(projectRoot, "overcommit");

const isYorkieProject = (projectRoot: string): boolean =>
  packageHasRecordKey(projectRoot, "gitHooks") || packageHasDependency(projectRoot, "yorkie");

const isGhooksProject = (projectRoot: string): boolean =>
  packageHasDependency(projectRoot, "ghooks") ||
  packageHasNestedRecordKey(projectRoot, "config", "ghooks");

const isGitHooksJsProject = (projectRoot: string): boolean =>
  packageHasRecordKey(projectRoot, "git-hooks") ||
  packageHasDependency(projectRoot, "git-hooks-js");

const isPreCommitNpmProject = (projectRoot: string): boolean =>
  packageHasDependency(projectRoot, "pre-commit");

const isPrettyQuickProject = (projectRoot: string): boolean =>
  packageHasDependency(projectRoot, "pretty-quick");

export const detectGitHookTarget = (projectRoot: string): GitHookTarget | null => {
  if (runGit(projectRoot, ["rev-parse", "--is-inside-work-tree"]) !== "true") return null;

  const topLevel = runGit(projectRoot, ["rev-parse", "--show-toplevel"]) ?? projectRoot;
  const configuredHooksPath = runGit(projectRoot, ["config", "--path", "--get", "core.hooksPath"]);

  if (configuredHooksPath !== null && configuredHooksPath.length > 0) {
    return {
      hookPath: path.join(resolveGitPath(topLevel, configuredHooksPath), HOOK_FILE_NAME),
      runnerRoot: topLevel,
      kind: GitHookKind.Configured,
    };
  }

  if (isHuskyProject(topLevel)) {
    return {
      hookPath: path.join(topLevel, HUSKY_HOOKS_PATH, HOOK_FILE_NAME),
      runnerRoot: topLevel,
      kind: GitHookKind.Husky,
      hooksPathConfig: HUSKY_HOOKS_PATH,
    };
  }

  if (isVitePlusProject(topLevel)) {
    return {
      hookPath: path.join(topLevel, VITE_PLUS_HOOKS_PATH, HOOK_FILE_NAME),
      runnerRoot: topLevel,
      kind: GitHookKind.VitePlus,
      hooksPathConfig: VITE_PLUS_HOOKS_PATH,
    };
  }

  if (isSimpleGitHooksProject(topLevel)) {
    return {
      hookPath: path.join(topLevel, "package.json"),
      runnerRoot: topLevel,
      kind: GitHookKind.SimpleGitHooks,
    };
  }

  const lefthookConfigPath = getLefthookConfigPath(topLevel);
  if (lefthookConfigPath !== null) {
    return {
      hookPath: lefthookConfigPath,
      runnerRoot: topLevel,
      kind: GitHookKind.Lefthook,
    };
  }

  if (isPreCommitProject(topLevel)) {
    return {
      hookPath: path.join(topLevel, PRE_COMMIT_CONFIG_FILE),
      runnerRoot: topLevel,
      kind: GitHookKind.PreCommit,
    };
  }

  if (isOvercommitProject(topLevel)) {
    return {
      hookPath: path.join(topLevel, OVERCOMMIT_CONFIG_FILE),
      runnerRoot: topLevel,
      kind: GitHookKind.Overcommit,
    };
  }

  if (isYorkieProject(topLevel)) {
    return {
      hookPath: getPackageJsonPath(topLevel),
      runnerRoot: topLevel,
      kind: GitHookKind.Yorkie,
    };
  }

  if (isGhooksProject(topLevel)) {
    return {
      hookPath: getPackageJsonPath(topLevel),
      runnerRoot: topLevel,
      kind: GitHookKind.Ghooks,
    };
  }

  if (isGitHooksJsProject(topLevel)) {
    return {
      hookPath: getPackageJsonPath(topLevel),
      runnerRoot: topLevel,
      kind: GitHookKind.GitHooksJs,
    };
  }

  if (isPreCommitNpmProject(topLevel)) {
    return {
      hookPath: getPackageJsonPath(topLevel),
      runnerRoot: topLevel,
      kind: GitHookKind.PreCommitNpm,
    };
  }

  if (isPrettyQuickProject(topLevel)) {
    return {
      hookPath: getPackageJsonPath(topLevel),
      runnerRoot: topLevel,
      kind: GitHookKind.PrettyQuick,
    };
  }

  const hookPath = runGit(projectRoot, ["rev-parse", "--git-path", HOOK_RELATIVE_PATH]);
  if (hookPath === null || hookPath.length === 0) return null;

  return {
    hookPath: resolveGitPath(projectRoot, hookPath),
    runnerRoot: topLevel,
    kind: GitHookKind.Git,
  };
};

export const installReactDoctorGitHook = (options: InstallGitHookOptions): InstallGitHookResult => {
  if (options.kind === GitHookKind.SimpleGitHooks) return installSimpleGitHooks(options);
  if (options.kind === GitHookKind.Lefthook) return installLefthook(options);
  if (options.kind === GitHookKind.PreCommit) return installPreCommit(options);
  if (options.kind === GitHookKind.Overcommit) return installOvercommit(options);
  if (options.kind === GitHookKind.Yorkie) return installYorkie(options);
  if (options.kind === GitHookKind.Ghooks) return installGhooks(options);
  if (options.kind === GitHookKind.GitHooksJs) return installGitHooksJs(options);
  if (options.kind === GitHookKind.PreCommitNpm) return installPreCommitNpm(options);
  if (options.kind === GitHookKind.PrettyQuick) return installPrettyQuick(options);
  return installDirectGitHook(options);
};
