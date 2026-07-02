import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as fs from "node:fs";
import { clearConfigCache } from "@react-doctor/core";
import { runProjectMigrations } from "../src/cli/utils/cli-migrations.js";
import { CONFIG_DIR_ENV_VAR } from "../src/cli/utils/cli-state-store.js";

// Integration tests for the real registered migrations (not the framework with
// a fake one): each should apply exactly once, print its summary, and be
// recorded so it never re-runs. Config state is isolated to a temp dir.
describe("runProjectMigrations", () => {
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

  describe("agent-hooks-sh-to-mjs", () => {
    const writeLegacyClaudeHook = (): void => {
      const settingsPath = path.join(projectRoot, ".claude/settings.json");
      const legacyScriptPath = path.join(projectRoot, ".claude/hooks/react-doctor.sh");
      fs.mkdirSync(path.dirname(legacyScriptPath), { recursive: true });
      fs.writeFileSync(legacyScriptPath, "#!/bin/sh\nexit 0\n");
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          hooks: {
            PostToolBatch: [
              {
                hooks: [
                  {
                    type: "command",
                    command: 'sh "$CLAUDE_PROJECT_DIR/.claude/hooks/react-doctor.sh"',
                  },
                ],
              },
            ],
          },
        }),
      );
    };

    it("upgrades a legacy Claude shell hook, prints the summary, and records the migration", async () => {
      writeLegacyClaudeHook();

      const report = await runProjectMigrations(projectRoot);

      expect(report).toContainEqual({ id: "agent-hooks-sh-to-mjs", ran: true, applied: true });
      const settings: { hooks: { PostToolBatch: Array<{ hooks: Array<{ command: string }> }> } } =
        JSON.parse(fs.readFileSync(path.join(projectRoot, ".claude/settings.json"), "utf8"));
      const hookCommands = settings.hooks.PostToolBatch.flatMap((group) =>
        group.hooks.map((hook) => hook.command),
      );
      expect(hookCommands).toHaveLength(1);
      expect(hookCommands[0]).toContain("react-doctor.mjs");
      expect(fs.existsSync(path.join(projectRoot, ".claude/hooks/react-doctor.sh"))).toBe(false);
      expect(fs.existsSync(path.join(projectRoot, ".claude/hooks/react-doctor.mjs"))).toBe(true);
      expect(capturedOutput()).toContain("Upgraded the legacy react-doctor.sh agent hook");
    });

    it("stays pending with no legacy hooks and doesn't touch agent settings", async () => {
      const report = await runProjectMigrations(projectRoot);

      expect(report).toContainEqual({ id: "agent-hooks-sh-to-mjs", ran: true, applied: false });
      expect(fs.existsSync(path.join(projectRoot, ".claude"))).toBe(false);
      expect(fs.existsSync(path.join(projectRoot, ".cursor"))).toBe(false);
    });

    it("does not run again once applied (recorded)", async () => {
      writeLegacyClaudeHook();
      await runProjectMigrations(projectRoot);
      logSpy.mockClear();

      const second = await runProjectMigrations(projectRoot);

      expect(second).toContainEqual({ id: "agent-hooks-sh-to-mjs", ran: false, applied: true });
      expect(logSpy.mock.calls.length).toBe(0);
    });

    it("ignores a user's own wrapper outside our install paths (anchored detection)", async () => {
      const configPath = path.join(projectRoot, ".cursor/hooks.json");
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const userConfig = JSON.stringify({
        version: 1,
        hooks: {
          postToolUse: [{ command: "bash scripts/hooks/react-doctor.sh", matcher: "Write" }],
        },
      });
      fs.writeFileSync(configPath, userConfig);

      const report = await runProjectMigrations(projectRoot);

      expect(report).toContainEqual({ id: "agent-hooks-sh-to-mjs", ran: true, applied: false });
      expect(fs.readFileSync(configPath, "utf8")).toBe(userConfig);
    });
  });
});
