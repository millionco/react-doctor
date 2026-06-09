import * as path from "node:path";
import Conf from "conf";
import { hashProjectRoot } from "./hash-project-root.js";

// Shares the one global `react-doctor` config file with onboarding +
// setup-prompt state; `Conf` preserves unknown keys, so this concern lives
// under its own top-level `actionUpgrades` map without clobbering theirs.
const GLOBAL_CONFIG_PROJECT_NAME = "react-doctor";

export type ActionUpgradeOutcome = "accepted" | "declined";

export interface ActionUpgradeStoreOptions {
  // Overrides the config dir; tests point this at a temp dir.
  readonly cwd?: string;
}

interface ActionUpgradeProjectConfig {
  readonly rootDirectory: string;
  readonly outcome: ActionUpgradeOutcome;
  readonly at: string;
}

interface ActionUpgradeGlobalConfig {
  readonly actionUpgrades?: Record<string, ActionUpgradeProjectConfig>;
}

const getActionUpgradeStore = (
  options: ActionUpgradeStoreOptions = {},
): Conf<ActionUpgradeGlobalConfig> =>
  new Conf<ActionUpgradeGlobalConfig>({
    projectName: GLOBAL_CONFIG_PROJECT_NAME,
    cwd: options.cwd,
  });

export const getActionUpgradePromptConfigPath = (options: ActionUpgradeStoreOptions = {}): string =>
  getActionUpgradeStore(options).path;

// Whether the upgrade offer was already answered (accepted OR declined) for
// this repo. Either answer suppresses future prompts so the offer is truly
// one-time — an accepted-but-unmerged PR shouldn't re-prompt on the next scan.
export const hasHandledActionUpgrade = (
  projectRoot: string,
  storeOptions: ActionUpgradeStoreOptions = {},
): boolean => {
  try {
    const store = getActionUpgradeStore(storeOptions);
    const upgrades = store.get("actionUpgrades", {});
    return Boolean(upgrades[hashProjectRoot(projectRoot)]);
  } catch {
    // Unreadable global-config dir (EPERM / EROFS in locked-down CI and
    // sandboxes). Fail safe to "already handled" so we never nag in an
    // environment that can't remember the answer — the prompt is
    // interactive-only and best skipped there anyway.
    return true;
  }
};

// Records the user's one-time answer for this repo. Returns whether it
// persisted (a read-only config dir just means the choice isn't remembered).
export const recordActionUpgradeDecision = (
  projectRoot: string,
  outcome: ActionUpgradeOutcome,
  storeOptions: ActionUpgradeStoreOptions = {},
): boolean => {
  try {
    const store = getActionUpgradeStore(storeOptions);
    const upgrades = store.get("actionUpgrades", {});
    store.set("actionUpgrades", {
      ...upgrades,
      [hashProjectRoot(projectRoot)]: {
        rootDirectory: path.resolve(projectRoot),
        outcome,
        at: new Date().toISOString(),
      },
    });
    return true;
  } catch {
    return false;
  }
};
