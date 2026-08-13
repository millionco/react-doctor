import { findLegacyConfig, toRelativePath } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import { type CliStateOptions } from "./cli-state-store.js";
import { type Migration, type MigrationResult, runMigrations } from "./cli-lifecycle.js";
import {
  findAgentsWithOutdatedReactDoctorHooks,
  installReactDoctorAgentHooks,
} from "./install-agent-hooks.js";
import { migrateActionPin } from "./migrate-action-pin.js";
import { migrateLegacyConfig } from "./migrate-legacy-config.js";

// The registry of code/config updates React Doctor applies to a user's repo.
// Each is a once-per-repo lifecycle migration: it runs at most once (tracked in
// the CLI state file) and re-runs only when its `version` is bumped. Add new
// migrations here — this list is the single, obvious home for "update old code".

// Renames a pre-migration `react-doctor.config.json` to a typed
// `doctor.config.ts`. Idempotent: with no legacy file it's a no-op that returns
// `false` (stays pending, so a file that appears later is still migrated); once
// it actually migrates a file it returns `true` and is recorded, so it never
// re-runs for that repo.
const legacyConfigToTypescript: Migration = {
  id: "config-json-to-ts",
  scope: "project",
  run: ({ projectRoot }) => {
    if (projectRoot === undefined) return false;
    const legacyConfig = findLegacyConfig(projectRoot);
    if (!legacyConfig) return false;

    const migratedPath = migrateLegacyConfig(legacyConfig);
    if (!migratedPath) return false;

    logger.success("Migrated react-doctor.config.json → doctor.config.ts");
    logger.dim(
      `  Your settings were preserved. Review ${toRelativePath(migratedPath, projectRoot)} and commit it.`,
    );
    logger.break();
    return true;
  },
};

// Pins a mutable `@main` / `@master` React Doctor action reference in the repo's
// workflows to the recommended floating major (`@v2`). An unpinned `@main` runs
// whatever the action's HEAD points to with the workflow's write permissions — a
// supply-chain risk (#299) — and the rewrite also moves the workflow onto the
// current install- and scan-cached action release. A pinned tag / SHA is
// deliberate and left untouched; with no mutable ref this is a no-op that
// returns `false` (stays pending, so a ref added later is still migrated).
const actionPinMainToMajor: Migration = {
  id: "action-pin-main-to-v2",
  scope: "project",
  run: ({ projectRoot }) => {
    if (projectRoot === undefined) return false;
    const rewrittenFiles = migrateActionPin(projectRoot);
    if (rewrittenFiles.length === 0) return false;

    const relativeFiles = rewrittenFiles
      .map((file) => toRelativePath(file, projectRoot))
      .join(", ");
    logger.success(`Pinned the React Doctor action to @v2 in ${relativeFiles}`);
    logger.dim(
      "  An unpinned @main reference runs whatever the action's HEAD points to (a supply-chain risk). Review and commit the change — or revert it if you intentionally track main.",
    );
    logger.break();
    return true;
  },
};

// Re-runs the installer for managed hooks that predate end-of-turn scanning.
// Version 2 also moves previously installed Node hooks from per-tool events to
// Stop events; version 1 only replaced the ≤0.5.8 shell scripts.
const agentHooksToStop: Migration = {
  id: "agent-hooks-sh-to-mjs",
  version: 2,
  scope: "project",
  run: ({ projectRoot }) => {
    if (projectRoot === undefined) return false;
    const agents = findAgentsWithOutdatedReactDoctorHooks(projectRoot);
    if (agents.length === 0) return false;

    installReactDoctorAgentHooks({ projectRoot, agents });
    logger.success(`Moved React Doctor agent hooks to end-of-turn checks (${agents.join(", ")})`);
    logger.dim(
      "  Hooks now scan changed and untracked files once when the agent stops. Review and commit the change.",
    );
    logger.break();
    return true;
  },
};

const PROJECT_MIGRATIONS: ReadonlyArray<Migration> = [
  legacyConfigToTypescript,
  actionPinMainToMajor,
  agentHooksToStop,
];

// Runs every pending per-repo migration for `projectRoot` once, recording the
// ones that apply. Safe to call on every scan — recorded migrations are skipped.
export const runProjectMigrations = (
  projectRoot: string,
  options: CliStateOptions = {},
): Promise<MigrationResult[]> => runMigrations(PROJECT_MIGRATIONS, { projectRoot }, options);
