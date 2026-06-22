import { detectInstalledSkillAgents, getSkillAgentTypes, type SkillAgentType } from "agent-install";
import { isCommandAvailable } from "./is-command-available.js";

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

// The popular coding agents `install` pre-selects by default when the user has
// no remembered selection yet — mirroring the Vercel `skills` CLI's curated
// default (`claude-code`, `opencode`, `codex`). Cursor is added because that CLI
// installs it unconditionally as an always-on universal agent, whereas React
// Doctor doesn't lock universal agents on, so it belongs in the default set
// here. Niche tools the user merely has installed somewhere in $HOME stay
// shown-but-unselected, so a machine full of AI tools doesn't get the skill
// copied into a dozen project-local directories just by pressing Enter.
export const DEFAULT_INSTALL_AGENTS: readonly SkillAgentType[] = [
  "claude-code",
  "cursor",
  "codex",
  "opencode",
];

// The agents `install` selects by default, following the Vercel `skills` CLI
// heuristic: prefer the user's remembered last selection; else the curated
// popular defaults; else (neither applies) a lone detected agent is the obvious
// pick and anything longer defaults to nothing, so the user makes a deliberate
// choice. Every candidate is intersected with the detected agents so we never
// pre-select something that isn't installed.
export const computeDefaultSelectedAgents = (
  detectedAgents: readonly SkillAgentType[],
  rememberedAgents: readonly SkillAgentType[],
): SkillAgentType[] => {
  const detected = new Set(detectedAgents);
  const remembered = rememberedAgents.filter((agent) => detected.has(agent));
  if (remembered.length > 0) return remembered;
  const defaults = DEFAULT_INSTALL_AGENTS.filter((agent) => detected.has(agent));
  if (defaults.length > 0) return defaults;
  return detectedAgents.length === 1 ? [...detectedAgents] : [];
};
