import * as path from "node:path";
import type { SkillAgentType } from "agent-install";
import { AGENT_HOOK_TIMEOUT_SECONDS } from "./constants.js";
import * as fs from "node:fs";
import { CliInputError } from "./cli-input-error.js";
import { writeJsonFile } from "./git-hook-shared.js";

interface InstallAgentHooksOptions {
  readonly projectRoot: string;
  readonly agents: readonly SkillAgentType[];
}

interface InstallAgentHooksResult {
  readonly installedAgents: readonly SkillAgentType[];
  readonly files: readonly string[];
}

interface ClaudeHookHandler {
  readonly type: "command";
  readonly command: string;
}

interface ClaudeHookGroup {
  readonly hooks?: readonly ClaudeHookHandler[];
  readonly matcher?: string;
}

interface ClaudeSettings {
  readonly hooks?: Record<string, readonly ClaudeHookGroup[]>;
  readonly [key: string]: unknown;
}

interface CursorHookHandler {
  readonly command: string;
  readonly matcher?: string;
  readonly timeout?: number;
}

interface CursorHooksConfig {
  readonly version?: number;
  readonly hooks?: Record<string, readonly CursorHookHandler[]>;
  readonly [key: string]: unknown;
}

const CLAUDE_AGENT = "claude-code";
const CURSOR_AGENT = "cursor";
const CLAUDE_SETTINGS_RELATIVE_PATH = ".claude/settings.json";
const CLAUDE_HOOK_RELATIVE_PATH = ".claude/hooks/react-doctor.mjs";
const CLAUDE_HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/react-doctor.mjs"';
const CURSOR_HOOKS_RELATIVE_PATH = ".cursor/hooks.json";
const CURSOR_HOOK_RELATIVE_PATH = ".cursor/hooks/react-doctor.mjs";
const CURSOR_HOOK_COMMAND = "node .cursor/hooks/react-doctor.mjs";
const CURSOR_HOOK_MATCHER = "Write|Edit|MultiEdit|ApplyPatch";
const CURSOR_HOOKS_SCHEMA_VERSION = 1;
const JSON_INDENT_SPACES = 2;

const isSupportedAgent = (agent: SkillAgentType): boolean =>
  agent === CLAUDE_AGENT || agent === CURSOR_AGENT;

const readJsonFile = <Value>(filePath: string, fallback: Value): Value => {
  if (!fs.existsSync(filePath)) return fallback;
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (content.length === 0) return fallback;
  try {
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CliInputError(
        `Could not parse ${filePath}: the file contains invalid JSON. Fix the syntax errors in this file and re-run the install command.`,
      );
    }
    throw error;
  }
};

const ensureDirectoryExists = (directoryPath: string): void => {
  try {
    fs.mkdirSync(directoryPath, { recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new CliInputError(
        `Could not create directory ${directoryPath}: permission denied. Ensure you have write permissions for this location and re-run the install command.`,
      );
    }
    // A recursive `mkdir` reports a conflicting file two ways: `EEXIST` when the
    // target itself is a file, `ENOTDIR` when a parent segment is. The code
    // already settles it — don't `statSync` to confirm, because on the
    // `ENOTDIR` (parent-is-a-file) case the stat throws `ENOTDIR` too and the
    // actionable message would be lost (the original REACT-DOCTOR-17 path).
    if (code === "ENOTDIR" || code === "EEXIST") {
      throw new CliInputError(
        `Could not create directory ${directoryPath}: a file exists at this path or one of its parent paths. Remove the conflicting file and re-run the install command.`,
      );
    }
    throw error;
  }
};

const writeJsonFileWithDirectoryCheck = (filePath: string, value: unknown): void => {
  ensureDirectoryExists(path.dirname(filePath));
  writeJsonFile(filePath, value);
};

const writeHookScript = (filePath: string): void => {
  ensureDirectoryExists(path.dirname(filePath));
  fs.writeFileSync(filePath, buildAgentHookScript());
};

const hasClaudeHookCommand = (groups: readonly ClaudeHookGroup[]): boolean =>
  groups.some((group) => (group.hooks ?? []).some((hook) => hook.command === CLAUDE_HOOK_COMMAND));

const installClaudeHook = (projectRoot: string): readonly string[] => {
  const settingsPath = path.join(projectRoot, CLAUDE_SETTINGS_RELATIVE_PATH);
  const hookPath = path.join(projectRoot, CLAUDE_HOOK_RELATIVE_PATH);
  const settings = readJsonFile<ClaudeSettings>(settingsPath, {});
  const hooks = { ...(settings.hooks ?? {}) };
  const postToolBatchHooks = [...(hooks.PostToolBatch ?? [])];

  if (!hasClaudeHookCommand(postToolBatchHooks)) {
    postToolBatchHooks.push({
      hooks: [
        {
          type: "command",
          command: CLAUDE_HOOK_COMMAND,
        },
      ],
    });
  }

  hooks.PostToolBatch = postToolBatchHooks;
  writeJsonFileWithDirectoryCheck(settingsPath, { ...settings, hooks });
  writeHookScript(hookPath);

  return [settingsPath, hookPath];
};

const hasCursorHookCommand = (handlers: readonly CursorHookHandler[]): boolean =>
  handlers.some((handler) => handler.command === CURSOR_HOOK_COMMAND);

const installCursorHook = (projectRoot: string): readonly string[] => {
  const configPath = path.join(projectRoot, CURSOR_HOOKS_RELATIVE_PATH);
  const hookPath = path.join(projectRoot, CURSOR_HOOK_RELATIVE_PATH);
  const config = readJsonFile<CursorHooksConfig>(configPath, {});
  const hooks = { ...(config.hooks ?? {}) };
  const postToolUseHooks = [...(hooks.postToolUse ?? [])];

  if (!hasCursorHookCommand(postToolUseHooks)) {
    postToolUseHooks.push({
      command: CURSOR_HOOK_COMMAND,
      matcher: CURSOR_HOOK_MATCHER,
      timeout: AGENT_HOOK_TIMEOUT_SECONDS,
    });
  }

  hooks.postToolUse = postToolUseHooks;
  writeJsonFileWithDirectoryCheck(configPath, {
    ...config,
    version: config.version ?? CURSOR_HOOKS_SCHEMA_VERSION,
    hooks,
  });
  writeHookScript(hookPath);

  return [configPath, hookPath];
};

const buildAgentHookScript = (): string =>
  [
    "import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';",
    "import { tmpdir } from 'node:os';",
    "import { join, dirname } from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { spawnSync } from 'node:child_process';",
    "",
    "const __filename = fileURLToPath(import.meta.url);",
    "const __dirname = dirname(__filename);",
    "",
    "const EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'ApplyPatch']);",
    "",
    "const readStdin = () => {",
    "  try {",
    "    return readFileSync(0, 'utf8');",
    "  } catch {",
    "    return '';",
    "  }",
    "};",
    "",
    "const shouldScan = (input) => {",
    "  const eventName = input.hook_event_name || input.eventName || input.event_name;",
    "  if (eventName === 'PostToolBatch') {",
    "    const toolCalls = Array.isArray(input.tool_calls) ? input.tool_calls : [];",
    "    return toolCalls.some((toolCall) => EDIT_TOOL_NAMES.has(toolCall.tool_name));",
    "  }",
    "  const toolName = input.tool_name || input.toolName || input.tool;",
    "  return !toolName || EDIT_TOOL_NAMES.has(toolName);",
    "};",
    "",
    "const runReactDoctor = (outputPath) => {",
    "  // Each candidate is a single shell command string (not an args array):",
    "  // `shell: true` is required to run the Windows `.cmd` shims, and an args",
    "  // array with `shell: true` trips Node's DEP0190. A missing command exits",
    "  // 127 via the shell (no ENOENT error), so fall through on that. With no",
    "  // runner found, exit 0 silently — stdout is parsed as the hook's JSON.",
    "  const commands = [",
    "    './node_modules/.bin/react-doctor --verbose --scope changed --blocking warning --no-score',",
    "    'react-doctor --verbose --scope changed --blocking warning --no-score',",
    "    'pnpm dlx react-doctor@latest --verbose --scope changed --blocking warning --no-score',",
    "    'npx --yes react-doctor@latest --verbose --scope changed --blocking warning --no-score',",
    "  ];",
    "",
    "  for (const command of commands) {",
    "    const result = spawnSync(command, { encoding: 'utf8', shell: true });",
    "    if (result.error?.code === 'ENOENT' || result.status === 127) continue;",
    "    try {",
    "      writeFileSync(outputPath, (result.stdout || '') + (result.stderr || ''));",
    "    } catch {}",
    "    return result.status;",
    "  }",
    "",
    "  return 0;",
    "};",
    "",
    "const cleanup = (...paths) => {",
    "  for (const path of paths) {",
    "    try { unlinkSync(path); } catch {}",
    "  }",
    "};",
    "",
    "const main = () => {",
    "  let input;",
    "  try {",
    "    const stdinContent = readStdin();",
    "    input = JSON.parse(stdinContent || '{}');",
    "  } catch {",
    "    input = {};",
    "  }",
    "",
    "  if (!shouldScan(input)) {",
    "    process.exit(0);",
    "  }",
    "",
    "  const projectRoot = process.env.CLAUDE_PROJECT_DIR || join(__dirname, '../..');",
    "  const outputPath = join(tmpdir(), `react-doctor-agent-hook-output-${process.pid}.txt`);",
    "",
    "  try {",
    "    process.chdir(projectRoot);",
    "  } catch {",
    "    process.exit(0);",
    "  }",
    "",
    "  const scanResult = runReactDoctor(outputPath);",
    "  if (scanResult === 0) {",
    "    cleanup(outputPath);",
    "    process.exit(0);",
    "  }",
    "",
    "  const scanOutput = readFileSync(outputPath, 'utf8').trim();",
    "  cleanup(outputPath);",
    "",
    "  if (!scanOutput) {",
    "    process.exit(0);",
    "  }",
    "",
    "  const message = `React Doctor found issues in the changed files. Review this output and fix the regressions before finishing. For confirmed issues that cannot be fixed now, create GitHub issues with the rule, file/line, confidence, impact, and proposed fix.\\n\\n${scanOutput}`;",
    "",
    "  if (input.hook_event_name === 'PostToolBatch') {",
    "    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolBatch', additionalContext: message } }));",
    "  } else {",
    "    console.log(JSON.stringify({ additional_context: message }));",
    "  }",
    "};",
    "",
    "main();",
  ].join("\n");

export const installReactDoctorAgentHooks = (
  options: InstallAgentHooksOptions,
): InstallAgentHooksResult => {
  const installedAgents: SkillAgentType[] = [];
  const files: string[] = [];
  const requestedAgents = options.agents.filter(isSupportedAgent);

  for (const agent of requestedAgents) {
    if (agent === CLAUDE_AGENT) {
      files.push(...installClaudeHook(options.projectRoot));
      installedAgents.push(agent);
    }
    if (agent === CURSOR_AGENT) {
      files.push(...installCursorHook(options.projectRoot));
      installedAgents.push(agent);
    }
  }

  return { installedAgents, files };
};
