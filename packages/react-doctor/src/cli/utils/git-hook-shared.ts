import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

export const HOOK_FILE_NAME = "pre-commit";
export const HOOK_RELATIVE_PATH = "hooks/pre-commit";
export const LEGACY_HOOK_RUNNER_RELATIVE_PATH = ".react-doctor/hooks/pre-commit";
export const HUSKY_HOOKS_PATH = ".husky";
export const VITE_PLUS_HOOKS_PATH = ".vite-hooks";
export const SIMPLE_GIT_HOOKS_PACKAGE_JSON_KEY = "simple-git-hooks";
export const SIMPLE_GIT_HOOKS_CONFIG_FILE = ".simple-git-hooks.cjs";
export const LEFTHOOK_CONFIG_FILES = ["lefthook.yml", "lefthook.yaml"];
export const PRE_COMMIT_CONFIG_FILE = ".pre-commit-config.yaml";
export const OVERCOMMIT_CONFIG_FILE = ".overcommit.yml";
export const REACT_DOCTOR_COMMAND = "react-doctor --staged --blocking warning";
export const NON_BLOCKING_REACT_DOCTOR_COMMAND = [
  'react_doctor_output=$(mktemp "${TMPDIR:-/tmp}/react-doctor-hook.XXXXXX");',
  `if ${REACT_DOCTOR_COMMAND} > "$react_doctor_output" 2>&1; then`,
  'rm -f "$react_doctor_output";',
  "else",
  'rm -f "$react_doctor_output";',
  `printf "%s\\n" "React Doctor found staged regressions." "Run ${REACT_DOCTOR_COMMAND} to inspect." "Want them fixed? Ask your agent to run that command and resolve the findings." >&2;`,
  "fi",
].join(" ");
const PACKAGE_JSON_FILE_NAME = "package.json";

export const runGit = (projectRoot: string, args: ReadonlyArray<string>): string | null => {
  try {
    return execFileSync("git", [...args], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

export const resolveGitPath = (baseDirectory: string, value: string): string =>
  path.isAbsolute(value) ? value : path.resolve(baseDirectory, value);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const getPackageJsonPath = (projectRoot: string): string =>
  path.join(projectRoot, PACKAGE_JSON_FILE_NAME);

export const readPackageJson = (projectRoot: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(getPackageJsonPath(projectRoot), "utf8"));
  } catch {
    return null;
  }
};

export const writeJsonFile = (filePath: string, value: unknown): void => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const packageHasDependency = (projectRoot: string, dependencyName: string): boolean => {
  const packageJson = readPackageJson(projectRoot);
  if (!isRecord(packageJson)) return false;
  return ["dependencies", "devDependencies", "optionalDependencies"].some((fieldName) => {
    const dependencies = packageJson[fieldName];
    return isRecord(dependencies) && typeof dependencies[dependencyName] === "string";
  });
};

export const packageHasRecordKey = (projectRoot: string, key: string): boolean => {
  const packageJson = readPackageJson(projectRoot);
  return isRecord(packageJson) && isRecord(packageJson[key]);
};

export const packageHasNestedRecordKey = (
  projectRoot: string,
  key: string,
  nestedKey: string,
): boolean => {
  const packageJson = readPackageJson(projectRoot);
  if (!isRecord(packageJson)) return false;
  const value = packageJson[key];
  return isRecord(value) && isRecord(value[nestedKey]);
};

export const ensureTrailingNewline = (content: string): string =>
  content.endsWith("\n") ? content : `${content}\n`;
