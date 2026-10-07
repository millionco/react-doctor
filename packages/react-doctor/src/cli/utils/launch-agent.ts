import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillAgentType } from "agent-install";
import { isCommandAvailable } from "./is-command-available.js";

const isWindows = process.platform === "win32";

export type CliAgentId = "claude-code" | "codex" | "cursor";

export const CLI_AGENT_IDS: ReadonlyArray<CliAgentId> = ["claude-code", "codex", "cursor"];

// CLI agents we can hand off to by launching their binary with the prompt
// as the initial argument and inheriting the current terminal — so the
// agent takes over this TTY and control returns here when it exits. This
// is more robust and cross-platform than scripting a specific terminal
// app, and covers Claude Code, Codex, and Cursor's CLI agent. Keyed by
// `agent-install`'s `SkillAgentType` so labels come from `getSkillAgentConfig`.
export const CLI_AGENT_BINARIES = {
  "claude-code": "claude",
  codex: "codex",
  cursor: "cursor-agent",
} satisfies Record<CliAgentId, string> & Partial<Record<SkillAgentType, string>>;

// Each agent's "auto-run / skip-approval" flag. We hand off so the agent can
// FIX the issues end-to-end; stopping to confirm every edit & command would
// defeat the point, so we launch in each agent's bypass-approvals mode:
//   claude  → --dangerously-skip-permissions
//   codex   → --yolo (bypass approvals + sandbox)
//   cursor  → --force (auto-approve commands; `--yolo` is its alias)
// The user already opted in by picking the agent from the handoff menu.
const CLI_AGENT_AUTO_FLAGS = {
  "claude-code": ["--dangerously-skip-permissions"],
  codex: ["--yolo"],
  cursor: ["--force"],
} as const satisfies Record<CliAgentId, ReadonlyArray<string>>;

export interface WindowsCommandResolution {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

// HACK: Cursor installs its CLI as a bundled node.exe + index.js under
// %LOCALAPPDATA%\cursor-agent\versions\<latest>\. The .cmd wrapper on PATH
// calls PowerShell, which then runs the bundled node. We bypass the
// PowerShell hop by resolving the bundled node directly — preserving argv
// integrity and avoiding shell mangling of the multi-line prompt.
export const resolveCursorBundledNode = (): WindowsCommandResolution | null => {
  if (!isWindows) return null;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const cursorAgentRoot = path.join(localAppData, "cursor-agent", "versions");
  try {
    const versions = fs.readdirSync(cursorAgentRoot);
    if (versions.length === 0) return null;
    const sortedVersions = versions.sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    );
    for (const version of sortedVersions) {
      try {
        const bundledNodePath = path.join(cursorAgentRoot, version, "node.exe");
        const entryScriptPath = path.join(cursorAgentRoot, version, "index.js");
        if (fs.statSync(bundledNodePath).isFile() && fs.statSync(entryScriptPath).isFile()) {
          return { command: bundledNodePath, args: [entryScriptPath] };
        }
      } catch {}
    }
  } catch {}
  return null;
};

// HACK: On Windows, npm/pnpm/yarn install CLI tools as .cmd batch wrappers
// that Node's `spawn` cannot execute without `shell: true`. Using a shell
// would mangle the multi-line prompt (cmd.exe splits at newlines), so we
// parse the .cmd to find the underlying JS entry script and spawn Node
// directly — preserving argv integrity and bypassing cmd.exe entirely.
export const resolveWindowsCmdEntryScript = (command: string): string | null => {
  if (!isWindows) return null;
  const pathDirectories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of pathDirectories) {
    const cmdFilePath = path.join(directory, `${command}.cmd`);
    try {
      if (!fs.statSync(cmdFilePath).isFile()) continue;
    } catch {
      continue;
    }
    try {
      const cmdContent = fs.readFileSync(cmdFilePath, "utf8");
      const entryScriptMatch = cmdContent.match(/"%(?:~dp0|dp0%)\\([^"]+\.(?:m?js|cjs))"/);
      if (!entryScriptMatch) continue;
      const resolvedScriptPath = path.resolve(directory, entryScriptMatch[1]);
      if (fs.statSync(resolvedScriptPath).isFile()) return resolvedScriptPath;
    } catch {}
  }
  return null;
};

const spawnAgent = (command: string, args: ReadonlyArray<string>, cwd: string): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });

export const launchCliAgent = async (
  agentId: CliAgentId,
  prompt: string,
  cwd: string,
): Promise<number> => {
  const binary = CLI_AGENT_BINARIES[agentId];
  const agentArgs = [...CLI_AGENT_AUTO_FLAGS[agentId], prompt];

  if (isWindows) {
    if (agentId === "cursor") {
      const cursorResolution = resolveCursorBundledNode();
      if (cursorResolution) {
        return spawnAgent(cursorResolution.command, [...cursorResolution.args, ...agentArgs], cwd);
      }
    }

    const entryScript = resolveWindowsCmdEntryScript(binary);
    if (entryScript) {
      return spawnAgent(process.execPath, [entryScript, ...agentArgs], cwd);
    }
  }

  try {
    return await spawnAgent(binary, agentArgs, cwd);
  } catch {
    throw new Error(`Failed to launch ${binary}`);
  }
};

const CLIPBOARD_COMMANDS: ReadonlyArray<{ binary: string; args: string[] }> = [
  { binary: "pbcopy", args: [] },
  { binary: "wl-copy", args: [] },
  { binary: "xclip", args: ["-selection", "clipboard"] },
  { binary: "xsel", args: ["--clipboard", "--input"] },
  { binary: "clip", args: [] },
];

// Best-effort copy to the OS clipboard via whichever tool is present.
// Resolves true on success, false when no clipboard tool is available or
// the write fails — callers fall back to printing the prompt.
export const copyToClipboard = (text: string): Promise<boolean> => {
  const command = CLIPBOARD_COMMANDS.find((candidate) => isCommandAvailable(candidate.binary));
  if (!command) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const child = spawn(command.binary, command.args);
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    child.stdin.on("error", () => resolve(false));
    child.stdin.end(text);
  });
};
