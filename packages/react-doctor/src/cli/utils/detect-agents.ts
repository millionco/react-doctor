import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { detectInstalledSkillAgents, getSkillAgentTypes, type SkillAgentType } from "agent-install";

// HACK: PATH binaries we use as a *supplementary* detection signal on top
// of agent-install's filesystem detection. This catches users who just
// installed a CLI but haven't run it yet (no ~/.claude / ~/.cursor / etc.
// on disk yet). Only includes agents whose CLI ships an obvious binary
// name; FS-only agents (Goose, Windsurf, Roo, Cline, Kilo) rely entirely
// on agent-install's detection. "universal" is a synthetic install
// target with no binary or config dir.
const PATH_BINARIES: Partial<Record<SkillAgentType, readonly string[]>> = {
  "claude-code": ["claude"],
  codex: ["codex"],
  cursor: ["cursor", "agent"],
  droid: ["droid"],
  "gemini-cli": ["gemini"],
  "github-copilot": ["copilot"],
  opencode: ["opencode"],
  pi: ["pi", "omegon"],
};

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

const detectPathAvailableAgents = (): SkillAgentType[] => {
  const detected: SkillAgentType[] = [];
  for (const [agent, binaries] of Object.entries(PATH_BINARIES) as Array<
    [SkillAgentType, readonly string[]]
  >) {
    if (binaries.some(isCommandAvailable)) detected.push(agent);
  }
  return detected;
};

// Returns the union of PATH-detected agents (CLI binaries on $PATH) and
// agent-install's filesystem-detected agents (~/.claude, ~/.cursor, etc.).
// Order follows agent-install's `getSkillAgentTypes()` for deterministic
// UI; the synthetic "universal" type is filtered out because it isn't a
// user-facing agent.
export const detectAvailableAgents = async (): Promise<SkillAgentType[]> => {
  const detected = new Set<SkillAgentType>([
    ...detectPathAvailableAgents(),
    ...(await detectInstalledSkillAgents()),
  ]);
  return getSkillAgentTypes().filter((agent) => agent !== "universal" && detected.has(agent));
};
