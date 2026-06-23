import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as fs from "node:fs";
import {
  type Gate,
  type Migration,
  type Preference,
  clearGate,
  isGatePending,
  isMigrationPending,
  readGateOutcome,
  readPreference,
  recordGate,
  runMigrations,
  writePreference,
} from "../src/cli/utils/cli-lifecycle.js";

describe("cli-lifecycle", () => {
  let configRoot: string;
  let options: { cwd: string };

  beforeEach(() => {
    configRoot = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-lifecycle-"));
    options = { cwd: configRoot };
  });

  afterEach(() => {
    fs.rmSync(configRoot, { recursive: true, force: true });
  });

  describe("gates", () => {
    it("is pending before it fires and not after (global scope)", () => {
      const gate: Gate = { id: "onboarding", scope: "global" };
      expect(isGatePending(gate, {}, options)).toBe(true);
      expect(recordGate(gate, {}, options)).toBe(true);
      expect(isGatePending(gate, {}, options)).toBe(false);
    });

    it("records and reads an outcome (project scope)", () => {
      const gate: Gate = { id: "ci-pitch", scope: "project" };
      recordGate(gate, { projectRoot: "/repo/a", outcome: "accepted" }, options);
      expect(readGateOutcome(gate, { projectRoot: "/repo/a" }, options)).toBe("accepted");
      expect(isGatePending(gate, { projectRoot: "/repo/a" }, options)).toBe(false);
    });

    it("gates per repo independently", () => {
      const gate: Gate = { id: "ci-pitch", scope: "project" };
      recordGate(gate, { projectRoot: "/repo/a", outcome: "declined" }, options);
      expect(isGatePending(gate, { projectRoot: "/repo/a" }, options)).toBe(false);
      expect(isGatePending(gate, { projectRoot: "/repo/b" }, options)).toBe(true);
    });

    it("re-opens when the version is bumped (invalidation)", () => {
      const v1: Gate = { id: "cta", scope: "global", version: 1 };
      recordGate(v1, {}, options);
      expect(isGatePending(v1, {}, options)).toBe(false);
      // A reworked CTA bumps the version to re-show it.
      const v2: Gate = { id: "cta", scope: "global", version: 2 };
      expect(isGatePending(v2, {}, options)).toBe(true);
      recordGate(v2, {}, options);
      expect(isGatePending(v2, {}, options)).toBe(false);
    });

    it("can be explicitly cleared so it fires again", () => {
      const gate: Gate = { id: "cta", scope: "project" };
      recordGate(gate, { projectRoot: "/repo/a" }, options);
      expect(isGatePending(gate, { projectRoot: "/repo/a" }, options)).toBe(false);
      clearGate(gate, { projectRoot: "/repo/a" }, options);
      expect(isGatePending(gate, { projectRoot: "/repo/a" }, options)).toBe(true);
    });

    it("fails safe to not-pending on an unreadable store (default)", () => {
      // A cwd whose parent is a file makes conf's mkdir throw.
      const unwritableCwd = path.join(configRoot, "file-as-dir");
      fs.writeFileSync(unwritableCwd, "x");
      const gate: Gate = { id: "onboarding", scope: "global" };
      expect(isGatePending(gate, {}, { cwd: path.join(unwritableCwd, "nested") })).toBe(false);
    });

    it("honors fireWhenUnknown on an unreadable store (persistent hints)", () => {
      const unwritableCwd = path.join(configRoot, "file-as-dir");
      fs.writeFileSync(unwritableCwd, "x");
      const hint: Gate = { id: "setup-hint", scope: "project", fireWhenUnknown: true };
      expect(
        isGatePending(
          hint,
          { projectRoot: "/repo/a" },
          { cwd: path.join(unwritableCwd, "nested") },
        ),
      ).toBe(true);
    });

    it("treats a project gate with no projectRoot as not pending", () => {
      const gate: Gate = { id: "ci-pitch", scope: "project" };
      expect(isGatePending(gate, {}, options)).toBe(false);
    });
  });

  describe("migrations", () => {
    const makeMigration = (calls: string[], succeeds: boolean): Migration => ({
      id: "demo",
      scope: "project",
      run: ({ projectRoot }) => {
        calls.push(projectRoot ?? "<none>");
        return succeeds;
      },
    });

    it("runs a pending migration once and records it", async () => {
      const calls: string[] = [];
      const migration = makeMigration(calls, true);
      const first = await runMigrations([migration], { projectRoot: "/repo/a" }, options);
      expect(first).toEqual([{ id: "demo", ran: true, applied: true }]);
      expect(calls).toEqual(["/repo/a"]);
      expect(isMigrationPending(migration, { projectRoot: "/repo/a" }, options)).toBe(false);

      // Second pass: already recorded, so `run` is not invoked again.
      const second = await runMigrations([migration], { projectRoot: "/repo/a" }, options);
      expect(second).toEqual([{ id: "demo", ran: false, applied: true }]);
      expect(calls).toEqual(["/repo/a"]);
    });

    it("does not record a migration that reports no-op/failure (stays pending)", async () => {
      const calls: string[] = [];
      const migration = makeMigration(calls, false);
      const report = await runMigrations([migration], { projectRoot: "/repo/a" }, options);
      expect(report).toEqual([{ id: "demo", ran: true, applied: false }]);
      expect(isMigrationPending(migration, { projectRoot: "/repo/a" }, options)).toBe(true);
    });

    it("does not record a migration that throws (stays pending)", async () => {
      const migration: Migration = {
        id: "boom",
        scope: "project",
        run: () => {
          throw new Error("kaboom");
        },
      };
      const report = await runMigrations([migration], { projectRoot: "/repo/a" }, options);
      expect(report).toEqual([{ id: "boom", ran: true, applied: false }]);
      expect(isMigrationPending(migration, { projectRoot: "/repo/a" }, options)).toBe(true);
    });

    it("re-runs when the migration version is bumped", async () => {
      const calls: string[] = [];
      const v1: Migration = {
        id: "demo",
        scope: "global",
        version: 1,
        run: () => (calls.push("v1"), true),
      };
      await runMigrations([v1], {}, options);
      expect(calls).toEqual(["v1"]);
      const v2: Migration = {
        id: "demo",
        scope: "global",
        version: 2,
        run: () => (calls.push("v2"), true),
      };
      expect(isMigrationPending(v2, {}, options)).toBe(true);
      await runMigrations([v2], {}, options);
      expect(calls).toEqual(["v1", "v2"]);
    });
  });

  describe("preferences", () => {
    it("reads null before anything is written (global scope)", () => {
      const preference: Preference = { id: "handoff-target", scope: "global" };
      expect(readPreference(preference, {}, options)).toBe(null);
    });

    it("remembers the last written value and overwrites on re-write (global scope)", () => {
      const preference: Preference = { id: "handoff-target", scope: "global" };
      expect(writePreference(preference, "claude", {}, options)).toBe(true);
      expect(readPreference(preference, {}, options)).toBe("claude");
      expect(writePreference(preference, "skip", {}, options)).toBe(true);
      expect(readPreference(preference, {}, options)).toBe("skip");
    });

    it("scopes preferences per repo independently (project scope)", () => {
      const preference: Preference = { id: "handoff-target", scope: "project" };
      writePreference(preference, "cursor", { projectRoot: "/repo/a" }, options);
      expect(readPreference(preference, { projectRoot: "/repo/a" }, options)).toBe("cursor");
      expect(readPreference(preference, { projectRoot: "/repo/b" }, options)).toBe(null);
    });

    it("is a no-op for a project preference with no projectRoot", () => {
      const preference: Preference = { id: "handoff-target", scope: "project" };
      writePreference(preference, "claude", {}, options);
      expect(readPreference(preference, {}, options)).toBe(null);
    });

    it("keeps gate outcomes and preferences in separate namespaces", () => {
      const gate: Gate = { id: "handoff-target", scope: "global" };
      const preference: Preference = { id: "handoff-target", scope: "global" };
      recordGate(gate, { outcome: "accepted" }, options);
      writePreference(preference, "skip", {}, options);
      // Same id, different stores: the gate outcome is "accepted", the
      // preference value is "skip" — neither clobbers the other.
      expect(readGateOutcome(gate, {}, options)).toBe("accepted");
      expect(readPreference(preference, {}, options)).toBe("skip");
    });
  });
});
