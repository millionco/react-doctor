import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as fs from "node:fs";
import {
  CLI_STATE_SCHEMA_VERSION,
  getCliStatePath,
  migrateCliState,
  readCliState,
} from "../src/cli/utils/cli-state-store.js";
import { hasCompletedOnboarding } from "../src/cli/utils/onboarding-state.js";
import { hasHandledCiPrompt } from "../src/cli/utils/ci-prompt-decision.js";
import { hasHandledActionUpgrade } from "../src/cli/utils/action-upgrade-prompt.js";
import { hasDisabledSetupPrompt } from "../src/cli/utils/prompt-install-setup.js";
import { hashProjectRoot } from "../src/cli/utils/hash-project-root.js";

describe("cli-state-store schema migration", () => {
  describe("migrateCliState (pure)", () => {
    it("folds every legacy v1 key into the v2 scope/event model", () => {
      const repoHash = hashProjectRoot("/repo/a");
      const migrated = migrateCliState({
        onboardedAt: "2026-01-01T00:00:00.000Z",
        ciPrompts: {
          [repoHash]: {
            rootDirectory: "/repo/a",
            outcome: "declined",
            at: "2026-01-02T00:00:00.000Z",
          },
        },
        actionUpgrades: {
          [repoHash]: {
            rootDirectory: "/repo/a",
            outcome: "accepted",
            at: "2026-01-03T00:00:00.000Z",
          },
        },
        projects: { [repoHash]: { rootDirectory: "/repo/a", setupPrompt: false } },
      });

      expect(migrated.schemaVersion).toBe(CLI_STATE_SCHEMA_VERSION);
      expect(migrated.global?.events?.onboarding).toEqual({
        firedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      });
      const project = migrated.projects?.[repoHash];
      expect(project?.rootDirectory).toBe("/repo/a");
      expect(project?.events?.["ci-pitch"]?.outcome).toBe("declined");
      expect(project?.events?.["action-upgrade-v2"]?.outcome).toBe("accepted");
      expect(project?.events?.["setup-hint"]?.outcome).toBe("declined");
      // Legacy keys are dropped.
      expect(migrated.ciPrompts).toBeUndefined();
      expect(migrated.actionUpgrades).toBeUndefined();
      expect(project?.setupPrompt).toBeUndefined();
    });

    it("is idempotent on already-migrated state", () => {
      const once = migrateCliState({ onboardedAt: "2026-01-01T00:00:00.000Z" });
      const twice = migrateCliState(once);
      expect(twice).toEqual(once);
    });
  });

  describe("on-disk migration (no re-nag)", () => {
    let configRoot: string;

    beforeEach(() => {
      configRoot = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-store-"));
    });
    afterEach(() => {
      fs.rmSync(configRoot, { recursive: true, force: true });
    });

    it("upgrades a legacy file in place and preserves every recorded answer", () => {
      const repoHash = hashProjectRoot("/repo/a");
      const configPath = getCliStatePath({ cwd: configRoot });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          onboardedAt: "2026-01-01T00:00:00.000Z",
          ciPrompts: { [repoHash]: { rootDirectory: "/repo/a", outcome: "declined", at: "x" } },
          actionUpgrades: {
            [repoHash]: { rootDirectory: "/repo/a", outcome: "accepted", at: "y" },
          },
          projects: { [repoHash]: { rootDirectory: "/repo/a", setupPrompt: false } },
        }),
      );

      // Reading through the public API must see the preserved answers (no re-nag).
      expect(hasCompletedOnboarding({ cwd: configRoot })).toBe(true);
      expect(hasHandledCiPrompt("/repo/a", { cwd: configRoot })).toBe(true);
      expect(hasHandledActionUpgrade("/repo/a", { cwd: configRoot })).toBe(true);
      expect(hasDisabledSetupPrompt("/repo/a", { cwd: configRoot })).toBe(true);

      // And the file on disk is upgraded in place.
      const onDisk = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(onDisk.schemaVersion).toBe(CLI_STATE_SCHEMA_VERSION);
      expect(onDisk.ciPrompts).toBeUndefined();
    });

    it("stamps the schema version on a fresh store", () => {
      expect(readCliState((state) => state.schemaVersion, undefined, { cwd: configRoot })).toBe(
        CLI_STATE_SCHEMA_VERSION,
      );
    });
  });
});
