import { spawn } from "node:child_process";
import type { SkillAgentType } from "agent-install";
import { isCommandAvailable } from "./is-command-available.js";

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
} as const satisfies Partial<Record<SkillAgentType, string>>;

export type CliAgentId = keyof typeof CLI_AGENT_BINARIES;

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

// Hands the current terminal to the agent CLI with the prompt as its first
// positional argument (after the auto-approval flag), resolving with the
// agent's exit code once it quits. Uses `spawn` (no shell) so the multi-line
// prompt needs no escaping and can't be interpreted by a shell.
export const launchCliAgent = (agentId: CliAgentId, prompt: string, cwd: string): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(CLI_AGENT_BINARIES[agentId], [...CLI_AGENT_AUTO_FLAGS[agentId], prompt], {
      cwd,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });

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
