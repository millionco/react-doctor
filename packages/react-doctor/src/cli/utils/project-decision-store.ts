import * as path from "node:path";
import Conf from "conf";
import { REACT_DOCTOR_CONFIG_PROJECT_NAME } from "./constants.js";
import { hashProjectRoot } from "./hash-project-root.js";

export type ProjectDecisionOutcome = "accepted" | "declined";

export interface ProjectDecisionStoreOptions {
  // Overrides the config dir; tests point this at a temp dir.
  readonly cwd?: string;
}

interface ProjectDecisionRecord {
  readonly rootDirectory: string;
  readonly outcome: ProjectDecisionOutcome;
  readonly at: string;
}

export interface ProjectDecisionStore {
  readonly getConfigPath: (options?: ProjectDecisionStoreOptions) => string;
  readonly hasHandled: (projectRoot: string, options?: ProjectDecisionStoreOptions) => boolean;
  readonly record: (
    projectRoot: string,
    outcome: ProjectDecisionOutcome,
    options?: ProjectDecisionStoreOptions,
  ) => boolean;
}

// A once-per-repo "answered" decision (accepted OR declined), keyed by hashed
// project root and persisted under its own `storeKey` in the shared react-doctor
// config file. Backs the one-time prompts whose answer must outlast a single
// scan — the CI pitch and the `@v1` → `@v2` action-upgrade offer — so a recorded
// answer suppresses the prompt on later scans. `Conf` preserves unknown keys, so
// each store's `storeKey` coexists with the others (and with the onboarding /
// setup-prompt state) in one file.
export const createProjectDecisionStore = (storeKey: string): ProjectDecisionStore => {
  const getStore = (
    options: ProjectDecisionStoreOptions = {},
  ): Conf<Record<string, Record<string, ProjectDecisionRecord>>> =>
    new Conf<Record<string, Record<string, ProjectDecisionRecord>>>({
      projectName: REACT_DOCTOR_CONFIG_PROJECT_NAME,
      cwd: options.cwd,
    });

  return {
    getConfigPath: (options = {}) => getStore(options).path,
    hasHandled: (projectRoot, options = {}) => {
      try {
        return Boolean(getStore(options).get(storeKey, {})[hashProjectRoot(projectRoot)]);
      } catch {
        // Unreadable global-config dir (EPERM / EROFS in locked-down CI and
        // sandboxes). Fail safe to "already handled" so we never nag in an
        // environment that can't remember the answer.
        return true;
      }
    },
    record: (projectRoot, outcome, options = {}) => {
      try {
        const store = getStore(options);
        store.set(storeKey, {
          ...store.get(storeKey, {}),
          [hashProjectRoot(projectRoot)]: {
            rootDirectory: path.resolve(projectRoot),
            outcome,
            at: new Date().toISOString(),
          },
        });
        return true;
      } catch {
        // Couldn't persist (read-only config dir); the choice just isn't
        // remembered.
        return false;
      }
    },
  };
};
