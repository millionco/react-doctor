import * as path from "node:path";
import { GIT_HOOK_EXECUTABLE_MODE } from "./constants.js";
import * as fs from "node:fs";
import {
  ensureTrailingNewline,
  LEGACY_HOOK_RUNNER_RELATIVE_PATH,
  NON_BLOCKING_REACT_DOCTOR_COMMAND,
  REACT_DOCTOR_COMMAND,
  runGit,
} from "./git-hook-shared.js";
import {
  GitHookKind,
  type InstallGitHookOptions,
  type InstallGitHookResult,
} from "./git-hook-types.js";

const REACT_DOCTOR_BLOCK_START = "# react-doctor hook start";
const REACT_DOCTOR_BLOCK_END = "# react-doctor hook end";
const LEGACY_MANAGED_BLOCK_START = "# react-doctor hook launcher start";
const LEGACY_MANAGED_BLOCK_END = "# react-doctor hook launcher end";
const REACT_DOCTOR_BLOCK_PATTERN = new RegExp(
  `(?:${REACT_DOCTOR_BLOCK_START}[\\s\\S]*?${REACT_DOCTOR_BLOCK_END}\\n?|${LEGACY_MANAGED_BLOCK_START}[\\s\\S]*?${LEGACY_MANAGED_BLOCK_END}\\n?)`,
);
const SHEBANG = "#!/bin/sh";
const SHEBANG_PREFIX = "#!";
const LOCAL_REACT_DOCTOR_BIN = "./node_modules/.bin/react-doctor";
const PNPM_REACT_DOCTOR_COMMAND = "pnpm dlx react-doctor@latest --staged --fail-on warning";
const NPX_REACT_DOCTOR_COMMAND = "npx --yes react-doctor@latest --staged --fail-on warning";

const buildReactDoctorHookBlock = (): string =>
  [
    REACT_DOCTOR_BLOCK_START,
    "react_doctor_scan_staged_files() {",
    `  if [ -x "${LOCAL_REACT_DOCTOR_BIN}" ]; then`,
    `    "${LOCAL_REACT_DOCTOR_BIN}" ${REACT_DOCTOR_COMMAND.replace("react-doctor ", "")}`,
    "    return",
    "  fi",
    "",
    "  if command -v react-doctor >/dev/null 2>&1; then",
    `    ${REACT_DOCTOR_COMMAND}`,
    "    return",
    "  fi",
    "",
    "  if command -v pnpm >/dev/null 2>&1; then",
    `    ${PNPM_REACT_DOCTOR_COMMAND}`,
    "    return",
    "  fi",
    "",
    "  if command -v npx >/dev/null 2>&1; then",
    `    ${NPX_REACT_DOCTOR_COMMAND}`,
    "    return",
    "  fi",
    "",
    "  printf '%s\\n' \"react-doctor: command not found; skipping staged scan.\"",
    "}",
    "",
    'react_doctor_output=$(mktemp "${TMPDIR:-/tmp}/react-doctor-hook.XXXXXX")',
    'if react_doctor_scan_staged_files > "$react_doctor_output" 2>&1; then',
    '  rm -f "$react_doctor_output"',
    "else",
    '  rm -f "$react_doctor_output"',
    `  printf '%s\\n' "React Doctor found staged regressions." "Run ${REACT_DOCTOR_COMMAND} to inspect." "Want them fixed? Ask your agent to run that command and resolve the findings." >&2`,
    "fi",
    REACT_DOCTOR_BLOCK_END,
  ].join("\n");

const mergeHookContent = (existingContent: string): string => {
  const hookBlock = `${buildReactDoctorHookBlock()}\n`;

  if (REACT_DOCTOR_BLOCK_PATTERN.test(existingContent)) {
    return ensureTrailingNewline(existingContent.replace(REACT_DOCTOR_BLOCK_PATTERN, hookBlock));
  }

  if (existingContent.length === 0) return `${SHEBANG}\n\n${hookBlock}`;

  const normalizedExistingContent = ensureTrailingNewline(existingContent);

  if (normalizedExistingContent.startsWith(SHEBANG_PREFIX)) {
    const [shebangLine, ...remainingLines] = normalizedExistingContent.split("\n");
    return [shebangLine, "", hookBlock.trimEnd(), ...remainingLines].join("\n");
  }

  return `${SHEBANG}\n\n${hookBlock}${normalizedExistingContent}`;
};

export const removeLegacyManagedRunner = (projectRoot: string): void => {
  const runnerPath = path.join(projectRoot, LEGACY_HOOK_RUNNER_RELATIVE_PATH);
  fs.rmSync(runnerPath, { force: true });
  for (const directory of [path.dirname(runnerPath), path.join(projectRoot, ".react-doctor")]) {
    try {
      fs.rmdirSync(directory);
    } catch {}
  }
};

export const installDirectGitHook = (options: InstallGitHookOptions): InstallGitHookResult => {
  const didHookExist = fs.existsSync(options.hookPath);
  const existingContent = didHookExist ? fs.readFileSync(options.hookPath, "utf8") : "";
  const nextContent = mergeHookContent(existingContent);

  if (options.hooksPathConfig !== undefined) {
    runGit(options.projectRoot, ["config", "core.hooksPath", options.hooksPathConfig]);
  }

  fs.mkdirSync(path.dirname(options.hookPath), { recursive: true });
  fs.writeFileSync(options.hookPath, nextContent);
  fs.chmodSync(options.hookPath, GIT_HOOK_EXECUTABLE_MODE);
  removeLegacyManagedRunner(options.projectRoot);

  return {
    hookPath: options.hookPath,
    kind: options.kind ?? GitHookKind.Git,
    status: didHookExist ? "updated" : "created",
  };
};

export { NON_BLOCKING_REACT_DOCTOR_COMMAND, REACT_DOCTOR_COMMAND };
