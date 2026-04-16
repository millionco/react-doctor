import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

export type SupportedAgent =
  | "claude"
  | "codex"
  | "copilot"
  | "gemini"
  | "cursor"
  | "opencode"
  | "droid"
  | "pi";

interface AgentMeta {
  readonly binaries: readonly string[];
  readonly displayName: string;
  readonly skillDir: string;
}

const SUPPORTED_AGENTS: Record<SupportedAgent, AgentMeta> = {
  claude: { binaries: ["claude"], displayName: "Claude Code", skillDir: ".claude/skills" },
  codex: { binaries: ["codex"], displayName: "Codex", skillDir: ".codex/skills" },
  copilot: {
    binaries: ["copilot"],
    displayName: "GitHub Copilot",
    skillDir: ".github/copilot/skills",
  },
  gemini: { binaries: ["gemini"], displayName: "Gemini CLI", skillDir: ".gemini/skills" },
  cursor: { binaries: ["cursor", "agent"], displayName: "Cursor", skillDir: ".cursor/skills" },
  opencode: { binaries: ["opencode"], displayName: "OpenCode", skillDir: ".opencode/skills" },
  droid: { binaries: ["droid"], displayName: "Factory Droid", skillDir: ".droid/skills" },
  pi: { binaries: ["pi", "omegon"], displayName: "Pi", skillDir: ".pi/skills" },
};

export const ALL_SUPPORTED_AGENTS = Object.keys(SUPPORTED_AGENTS) as SupportedAgent[];

const isCommandAvailable = (command: string): boolean => {
  const pathDirectories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of pathDirectories) {
    const binaryPath = path.join(directory, command);
    try {
      if (statSync(binaryPath).isFile()) {
        accessSync(binaryPath, constants.X_OK);
        return true;
      }
    } catch {}
  }
  return false;
};

export const detectAvailableAgents = (): SupportedAgent[] =>
  ALL_SUPPORTED_AGENTS.filter((agent) =>
    SUPPORTED_AGENTS[agent].binaries.some(isCommandAvailable),
  );

export const toDisplayName = (agent: SupportedAgent): string => SUPPORTED_AGENTS[agent].displayName;

export const toSkillDir = (agent: SupportedAgent): string => SUPPORTED_AGENTS[agent].skillDir;
