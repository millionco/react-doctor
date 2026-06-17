import * as path from "node:path";
import Conf from "conf";
import { hashProjectRoot } from "./hash-project-root.js";

// Shares the one global `react-doctor` config file with onboarding +
// setup-prompt + action-upgrade state; `Conf` preserves unknown keys, so this
// concern lives under its own top-level `ciPrompts` map without clobbering
// theirs.
const GLOBAL_CONFIG_PROJECT_NAME = "react-doctor";

export type CiPromptDecisionOutcome = "accepted" | "declined";

export interface CiPromptDecisionStoreOptions {
  // Overrides the config dir; tests point this at a temp dir.
  readonly cwd?: string;
}

interface CiPromptProjectConfig {
  readonly rootDirectory: string;
  readonly outcome: CiPromptDecisionOutcome;
  readonly at: string;
}

interface CiPromptGlobalConfig {
  readonly ciPrompts?: Record<string, CiPromptProjectConfig>;
}

const getCiPromptStore = (options: CiPromptDecisionStoreOptions = {}): Conf<CiPromptGlobalConfig> =>
  new Conf<CiPromptGlobalConfig>({
    projectName: GLOBAL_CONFIG_PROJECT_NAME,
    cwd: options.cwd,
  });

export const getCiPromptConfigPath = (options: CiPromptDecisionStoreOptions = {}): string =>
  getCiPromptStore(options).path;

// Whether the "Add React Doctor to CI?" pitch was already answered (accepted OR
// declined) for this repo. Either answer suppresses future pitches so it's
// truly one-time — a decline shouldn't re-nag on every scan, and an accept that
// failed to install the workflow shouldn't re-pitch either (the user can re-run
// `react-doctor install`).
export const hasHandledCiPrompt = (
  projectRoot: string,
  storeOptions: CiPromptDecisionStoreOptions = {},
): boolean => {
  try {
    const store = getCiPromptStore(storeOptions);
    const prompts = store.get("ciPrompts", {});
    return Boolean(prompts[hashProjectRoot(projectRoot)]);
  } catch {
    // Unreadable global-config dir (EPERM / EROFS in locked-down CI and
    // sandboxes). Fail safe to "already handled" so we never nag in an
    // environment that can't remember the answer — the pitch is
    // interactive-only and best skipped there anyway.
    return true;
  }
};

// Records the user's one-time answer for this repo. Returns whether it
// persisted (a read-only config dir just means the choice isn't remembered).
export const recordCiPromptDecision = (
  projectRoot: string,
  outcome: CiPromptDecisionOutcome,
  storeOptions: CiPromptDecisionStoreOptions = {},
): boolean => {
  try {
    const store = getCiPromptStore(storeOptions);
    const prompts = store.get("ciPrompts", {});
    store.set("ciPrompts", {
      ...prompts,
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
