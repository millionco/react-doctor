import { type CliStateOptions, ACTION_UPGRADE_EVENT, getCliStatePath } from "./cli-state-store.js";
import { type Gate, isGatePending, recordGate } from "./cli-lifecycle.js";

// The `@v1` → `@v2` action-upgrade offer: a once-per-repo gate. Either answer
// closes it (an accepted-but-unmerged PR shouldn't re-prompt). When a future
// major ships, register a new gate id (e.g. `action-upgrade-v3`) rather than
// bumping this one, so the v2 answer stays remembered.
export const ACTION_UPGRADE_GATE: Gate = { id: ACTION_UPGRADE_EVENT, scope: "project" };

export const getActionUpgradePromptConfigPath = getCliStatePath;

// Whether the upgrade offer was already answered for this repo. Fails safe to
// "handled" on an unreadable store.
export const hasHandledActionUpgrade = (
  projectRoot: string,
  options: CliStateOptions = {},
): boolean => !isGatePending(ACTION_UPGRADE_GATE, { projectRoot }, options);

// Records the user's one-time answer for this repo. Returns whether it persisted.
export const recordActionUpgradeDecision = (
  projectRoot: string,
  outcome: "accepted" | "declined",
  options: CliStateOptions = {},
): boolean => recordGate(ACTION_UPGRADE_GATE, { projectRoot, outcome }, options);
