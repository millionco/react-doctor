import { findLegacyConfig, toRelativePath } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import { type CliStateOptions } from "./cli-state-store.js";
import { type Migration, type MigrationResult, runMigrations } from "./cli-lifecycle.js";
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

export const PROJECT_MIGRATIONS: ReadonlyArray<Migration> = [legacyConfigToTypescript];

// Runs every pending per-repo migration for `projectRoot` once, recording the
// ones that apply. Safe to call on every scan — recorded migrations are skipped.
export const runProjectMigrations = (
  projectRoot: string,
  options: CliStateOptions = {},
): Promise<MigrationResult[]> => runMigrations(PROJECT_MIGRATIONS, { projectRoot }, options);
