import { createProjectDecisionStore } from "./project-decision-store.js";
import type {
  ProjectDecisionOutcome,
  ProjectDecisionStoreOptions,
} from "./project-decision-store.js";

export type ActionUpgradeOutcome = ProjectDecisionOutcome;
export type ActionUpgradeStoreOptions = ProjectDecisionStoreOptions;

// The `@v1` → `@v2` action-upgrade offer is a one-time, per-repo decision.
// Either answer suppresses future prompts — an accepted-but-unmerged PR
// shouldn't re-prompt on the next scan.
const store = createProjectDecisionStore("actionUpgrades");

export const getActionUpgradePromptConfigPath = store.getConfigPath;
// Whether the upgrade offer was already answered (accepted OR declined) for this
// repo.
export const hasHandledActionUpgrade = store.hasHandled;
// Records the user's one-time answer for this repo. Returns whether it persisted.
export const recordActionUpgradeDecision = store.record;
