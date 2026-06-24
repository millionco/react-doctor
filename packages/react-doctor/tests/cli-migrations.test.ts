import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as fs from "node:fs";
import { clearConfigCache } from "@react-doctor/core";
import { runProjectMigrations } from "../src/cli/utils/cli-migrations.js";
import { CONFIG_DIR_ENV_VAR } from "../src/cli/utils/cli-state-store.js";

// Integration test for the real registered migration (not the framework with a
// fake one): a legacy `react-doctor.config.json` in `projectRoot` should be
// renamed to `doctor.config.ts` exactly once, print its summary, and be
// recorded so it never re-runs. Config state is isolated to a temp dir.
describe("runProjectMigrations — config-json-to-ts", () => {
  let projectRoot: string;
  let configDir: string;
  let originalConfigDir: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-migrations-"));
    configDir = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-migrations-config-"));
    originalConfigDir = process.env[CONFIG_DIR_ENV_VAR];
    process.env[CONFIG_DIR_ENV_VAR] = configDir;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
    if (originalConfigDir === undefined) {
      delete process.env[CONFIG_DIR_ENV_VAR];
    } else {
      process.env[CONFIG_DIR_ENV_VAR] = originalConfigDir;
    }
    clearConfigCache();
  });

  const writeLegacyConfig = (): void => {
    fs.writeFileSync(
      path.join(projectRoot, "react-doctor.config.json"),
      JSON.stringify({ $schema: "https://react.doctor/schema/config.json", lint: true }),
    );
  };

  const capturedOutput = (): string => logSpy.mock.calls.map((call) => String(call[0])).join("\n");

  it("renames the legacy config, prints the summary, and records the migration", async () => {
    writeLegacyConfig();

    const report = await runProjectMigrations(projectRoot);

    expect(report).toContainEqual({ id: "config-json-to-ts", ran: true, applied: true });
    expect(fs.existsSync(path.join(projectRoot, "react-doctor.config.json"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "doctor.config.ts"))).toBe(true);
    expect(capturedOutput()).toContain("Migrated react-doctor.config.json → doctor.config.ts");
  });

  it("is a no-op with no legacy config: stays pending, prints nothing", async () => {
    const report = await runProjectMigrations(projectRoot);

    expect(report).toContainEqual({ id: "config-json-to-ts", ran: true, applied: false });
    expect(logSpy.mock.calls.length).toBe(0);
  });

  it("does not run again once applied (recorded / idempotent)", async () => {
    writeLegacyConfig();
    await runProjectMigrations(projectRoot);
    logSpy.mockClear();

    // The legacy file is gone AND the migration is recorded; the second pass
    // skips `run` entirely rather than re-detecting.
    const second = await runProjectMigrations(projectRoot);

    expect(second).toContainEqual({ id: "config-json-to-ts", ran: false, applied: true });
    expect(logSpy.mock.calls.length).toBe(0);
  });
});
