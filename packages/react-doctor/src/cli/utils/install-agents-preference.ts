import { isSkillAgentType, type SkillAgentType } from "agent-install";
import { type CliStateOptions, INSTALL_AGENTS_PREFERENCE_ID } from "./cli-state-store.js";
import { type Preference, readPreference, writePreference } from "./cli-lifecycle.js";

// The agents the user selected at their last `install`, remembered globally —
// which coding agents you wire React Doctor into is a personal habit, not a
// per-repo setting — so the next install pre-selects the same picks anywhere.
// Mirrors the Vercel `skills` CLI's `lastSelectedAgents` lock. The Preference
// primitive stores one string, so the list is comma-encoded.
export const INSTALL_AGENTS_PREFERENCE: Preference = {
  id: INSTALL_AGENTS_PREFERENCE_ID,
  scope: "global",
};

const PREFERENCE_SEPARATOR = ",";

// The agents the user picked last, filtered to ones agent-install still
// recognizes (a stale id from an older release just drops out). Empty when the
// user has never picked or the store is unreadable — callers fall back to the
// curated defaults.
export const readInstallAgents = (options: CliStateOptions = {}): SkillAgentType[] => {
  const stored = readPreference(INSTALL_AGENTS_PREFERENCE, {}, options);
  if (stored === null) return [];
  return stored
    .split(PREFERENCE_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => isSkillAgentType(entry));
};

// Remembers the user's latest selection so the next install defaults to it.
// Returns whether it persisted.
export const rememberInstallAgents = (
  agents: readonly SkillAgentType[],
  options: CliStateOptions = {},
): boolean =>
  writePreference(INSTALL_AGENTS_PREFERENCE, agents.join(PREFERENCE_SEPARATOR), {}, options);
