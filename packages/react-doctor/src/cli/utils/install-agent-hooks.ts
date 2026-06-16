import * as path from "node:path";
import type { SkillAgentType } from "agent-install";
import { AGENT_HOOK_TIMEOUT_SECONDS, GIT_HOOK_EXECUTABLE_MODE } from "./constants.js";
import * as fs from "node:fs";

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
const CLAUDE_HOOK_RELATIVE_PATH = ".claude/hooks/react-doctor.sh";
const CLAUDE_HOOK_COMMAND = 'sh "$CLAUDE_PROJECT_DIR/.claude/hooks/react-doctor.sh"';
const CURSOR_HOOKS_RELATIVE_PATH = ".cursor/hooks.json";
const CURSOR_HOOK_RELATIVE_PATH = ".cursor/hooks/react-doctor.sh";
const CURSOR_HOOK_MATCHER = "Write|Edit|MultiEdit|ApplyPatch";
const CURSOR_HOOKS_SCHEMA_VERSION = 1;
const JSON_INDENT_SPACES = 2;

const isSupportedAgent = (agent: SkillAgentType): boolean =>
  agent === CLAUDE_AGENT || agent === CURSOR_AGENT;

const readJsonFile = <Value>(filePath: string, fallback: Value): Value => {
  if (!fs.existsSync(filePath)) return fallback;
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (content.length === 0) return fallback;
  return JSON.parse(content);
};

const writeJsonFile = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`);
};

const writeHookScript = (filePath: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buildAgentHookScript());
  fs.chmodSync(filePath, GIT_HOOK_EXECUTABLE_MODE);
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
  writeJsonFile(settingsPath, { ...settings, hooks });
  writeHookScript(hookPath);

  return [settingsPath, hookPath];
};

const hasCursorHookCommand = (handlers: readonly CursorHookHandler[]): boolean =>
  handlers.some((handler) => handler.command === CURSOR_HOOK_RELATIVE_PATH);

const installCursorHook = (projectRoot: string): readonly string[] => {
  const configPath = path.join(projectRoot, CURSOR_HOOKS_RELATIVE_PATH);
  const hookPath = path.join(projectRoot, CURSOR_HOOK_RELATIVE_PATH);
  const config = readJsonFile<CursorHooksConfig>(configPath, {});
  const hooks = { ...(config.hooks ?? {}) };
  const postToolUseHooks = [...(hooks.postToolUse ?? [])];

  if (!hasCursorHookCommand(postToolUseHooks)) {
    postToolUseHooks.push({
      command: CURSOR_HOOK_RELATIVE_PATH,
      matcher: CURSOR_HOOK_MATCHER,
      timeout: AGENT_HOOK_TIMEOUT_SECONDS,
    });
  }

  hooks.postToolUse = postToolUseHooks;
  writeJsonFile(configPath, {
    ...config,
    version: config.version ?? CURSOR_HOOKS_SCHEMA_VERSION,
    hooks,
  });
  writeHookScript(hookPath);

  return [configPath, hookPath];
};

const buildAgentHookScript = (): string =>
  [
    "#!/bin/sh",
    "set -u",
    "",
    'input_file=$(mktemp "${TMPDIR:-/tmp}/react-doctor-agent-hook.XXXXXX")',
    'output_file=$(mktemp "${TMPDIR:-/tmp}/react-doctor-agent-hook-output.XXXXXX")',
    'trap \'rm -f "$input_file" "$output_file"\' EXIT',
    'cat > "$input_file"',
    "",
    'script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)',
    "project_root=${CLAUDE_PROJECT_DIR:-}",
    'if [ -z "$project_root" ]; then',
    '  project_root=$(CDPATH= cd "$script_dir/../.." && pwd)',
    "fi",
    'if ! cd "$project_root"; then',
    "  exit 0",
    "fi",
    "",
    "should_scan() {",
    "  if ! command -v node >/dev/null 2>&1; then",
    "    return 0",
    "  fi",
    "",
    "  node - \"$input_file\" <<'NODE'",
    "const fs = require('node:fs');",
    "const inputPath = process.argv[2];",
    "const editToolNames = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'ApplyPatch']);",
    "try {",
    "  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8') || '{}');",
    "  const eventName = input.hook_event_name || input.eventName || input.event_name;",
    "  if (eventName === 'PostToolBatch') {",
    "    const toolCalls = Array.isArray(input.tool_calls) ? input.tool_calls : [];",
    "    process.exit(toolCalls.some((toolCall) => editToolNames.has(toolCall.tool_name)) ? 0 : 10);",
    "  }",
    "  const toolName = input.tool_name || input.toolName || input.tool;",
    "  process.exit(!toolName || editToolNames.has(toolName) ? 0 : 10);",
    "} catch {",
    "  process.exit(0);",
    "}",
    "NODE",
    "}",
    "",
    "run_react_doctor() {",
    "  if [ -x ./node_modules/.bin/react-doctor ]; then",
    "    ./node_modules/.bin/react-doctor --verbose --scope changed --blocking warning --no-score",
    "    return",
    "  fi",
    "",
    "  if command -v react-doctor >/dev/null 2>&1; then",
    "    react-doctor --verbose --scope changed --blocking warning --no-score",
    "    return",
    "  fi",
    "",
    "  if command -v pnpm >/dev/null 2>&1; then",
    "    pnpm dlx react-doctor@latest --verbose --scope changed --blocking warning --no-score",
    "    return",
    "  fi",
    "",
    "  if command -v npx >/dev/null 2>&1; then",
    "    npx --yes react-doctor@latest --verbose --scope changed --blocking warning --no-score",
    "    return",
    "  fi",
    "",
    "  printf '%s\\n' 'react-doctor: command not found; skipping agent hook scan.'",
    "  return 0",
    "}",
    "",
    "if ! should_scan; then",
    "  exit 0",
    "fi",
    "",
    'if run_react_doctor > "$output_file" 2>&1; then',
    "  exit 0",
    "fi",
    "",
    'node - "$input_file" "$output_file" <<\'NODE\'',
    "const fs = require('node:fs');",
    "const inputPath = process.argv[2];",
    "const outputPath = process.argv[3];",
    "const readInput = () => {",
    "  try {",
    "    return JSON.parse(fs.readFileSync(inputPath, 'utf8') || '{}');",
    "  } catch {",
    "    return {};",
    "  }",
    "};",
    "const input = readInput();",
    "const scanOutput = fs.readFileSync(outputPath, 'utf8').trim();",
    "if (!scanOutput) process.exit(0);",
    "const message = `React Doctor found issues in the changed files. Review this output and fix the regressions before finishing. For confirmed issues that cannot be fixed now, create GitHub issues with the rule, file/line, confidence, impact, and proposed fix.\\n\\n${scanOutput}`;",
    "if (input.hook_event_name === 'PostToolBatch') {",
    "  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolBatch', additionalContext: message } }));",
    "} else {",
    "  console.log(JSON.stringify({ additional_context: message }));",
    "}",
    "NODE",
    "",
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
