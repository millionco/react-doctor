import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { setLoggerSilent } from "@react-doctor/core";

// HACK: vi.mock is hoisted above the imports it replaces. The mock factory
// runs before any non-mock import, so we re-import inside each test to get
// the spied module.
vi.mock("../src/cli/utils/install-skill.js", () => ({
  runInstallSkill: vi.fn(),
}));

import { installAction } from "../src/cli/commands/install.js";
import { runInstallSkill } from "../src/cli/utils/install-skill.js";

describe("installAction (Commander action wrapper)", () => {
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    setLoggerSilent(true);
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    vi.mocked(runInstallSkill).mockReset();
  });

  afterEach(() => {
    setLoggerSilent(false);
    process.exitCode = originalExitCode;
  });

  // Regression guard for H2: installAction translates Commander's `--cwd`
  // (exposed as `options.cwd`) into `runInstallSkill({ projectRoot })`.
  // Typos in this thin wire-up (e.g. `projectRoot: options.dryRun`) would
  // silently send the wrong directory to the skill installer.
  it("forwards --cwd as projectRoot to runInstallSkill", async () => {
    await installAction({ cwd: "/tmp/some-project", yes: true, dryRun: true });
    expect(runInstallSkill).toHaveBeenCalledTimes(1);
    expect(runInstallSkill).toHaveBeenCalledWith({
      yes: true,
      dryRun: true,
      projectRoot: "/tmp/some-project",
    });
  });

  it("falls back to process.cwd() when --cwd is not provided", async () => {
    await installAction({ yes: true });
    expect(runInstallSkill).toHaveBeenCalledTimes(1);
    expect(runInstallSkill).toHaveBeenCalledWith({
      yes: true,
      dryRun: undefined,
      projectRoot: process.cwd(),
    });
  });

  it("propagates --yes and --dry-run independently of --cwd", async () => {
    await installAction({ yes: false, dryRun: true, cwd: "/tmp/other" });
    expect(runInstallSkill).toHaveBeenCalledWith({
      yes: false,
      dryRun: true,
      projectRoot: "/tmp/other",
    });
  });

  it("delegates thrown errors to handleError without re-throwing", async () => {
    vi.mocked(runInstallSkill).mockRejectedValueOnce(new Error("boom"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    try {
      await expect(installAction({ yes: true })).rejects.toThrow("process.exit(1)");
    } finally {
      exitSpy.mockRestore();
    }
  });
});
