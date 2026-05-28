import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { silenceConsoleForTest } from "./helpers/silence-console.js";

// HACK: vi.mock is hoisted above the imports it replaces. The mock factory
// runs before any non-mock import, so we re-import inside each test to get
// the spied module.
vi.mock("../src/cli/utils/install-react-doctor.js", () => ({
  runInstallReactDoctor: vi.fn(),
}));

import { installAction } from "../src/cli/commands/install.js";
import { runInstallReactDoctor } from "../src/cli/utils/install-react-doctor.js";

describe("installAction (Commander action wrapper)", () => {
  let originalExitCode: number | string | undefined;
  let restoreConsole: () => void;

  beforeEach(() => {
    restoreConsole = silenceConsoleForTest();
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    vi.mocked(runInstallReactDoctor).mockReset();
  });

  afterEach(() => {
    restoreConsole();
    process.exitCode = originalExitCode;
  });

  // Regression guard for H2: installAction translates Commander's `--cwd`
  // (exposed as `options.cwd`) into `runInstallReactDoctor({ projectRoot })`.
  // Typos in this thin wire-up (e.g. `projectRoot: options.dryRun`) would
  // silently send the wrong directory to the installer.
  it("forwards --cwd as projectRoot to runInstallReactDoctor", async () => {
    await installAction({ cwd: "/tmp/some-project", yes: true, dryRun: true });
    expect(runInstallReactDoctor).toHaveBeenCalledTimes(1);
    expect(runInstallReactDoctor).toHaveBeenCalledWith({
      yes: true,
      dryRun: true,
      agentHooks: undefined,
      projectRoot: "/tmp/some-project",
    });
  });

  it("falls back to process.cwd() when --cwd is not provided", async () => {
    await installAction({ yes: true });
    expect(runInstallReactDoctor).toHaveBeenCalledTimes(1);
    expect(runInstallReactDoctor).toHaveBeenCalledWith({
      yes: true,
      dryRun: undefined,
      agentHooks: undefined,
      projectRoot: process.cwd(),
    });
  });

  it("propagates --yes and --dry-run independently of --cwd", async () => {
    await installAction({ yes: false, dryRun: true, cwd: "/tmp/other" });
    expect(runInstallReactDoctor).toHaveBeenCalledWith({
      yes: false,
      dryRun: true,
      agentHooks: undefined,
      projectRoot: "/tmp/other",
    });
  });

  it("forwards --agent-hooks to runInstallReactDoctor", async () => {
    await installAction({ yes: true, agentHooks: true, cwd: "/tmp/agent-hooks" });
    expect(runInstallReactDoctor).toHaveBeenCalledWith({
      yes: true,
      dryRun: undefined,
      agentHooks: true,
      projectRoot: "/tmp/agent-hooks",
    });
  });

  it("uses the parent --yes value when Commander stores it on the root command", async () => {
    await installAction(
      {
        dryRun: true,
        cwd: "/tmp/root-yes",
      },
      {
        parent: {
          opts: () => ({ yes: true }),
        },
      },
    );
    expect(runInstallReactDoctor).toHaveBeenCalledWith({
      yes: true,
      dryRun: true,
      agentHooks: undefined,
      projectRoot: "/tmp/root-yes",
    });
  });

  it("keeps an explicit child yes value ahead of the parent value", async () => {
    await installAction(
      {
        yes: false,
        dryRun: true,
        cwd: "/tmp/child-yes",
      },
      {
        parent: {
          opts: () => ({ yes: true }),
        },
      },
    );
    expect(runInstallReactDoctor).toHaveBeenCalledWith({
      yes: false,
      dryRun: true,
      agentHooks: undefined,
      projectRoot: "/tmp/child-yes",
    });
  });

  it("forwards --yes from Commander-shaped command arguments", async () => {
    await installAction(
      {
        dryRun: true,
        agentHooks: true,
        cwd: "/tmp/commander-shape",
      },
      {
        parent: {
          opts: () => ({ yes: true }),
        },
      },
    );
    expect(runInstallReactDoctor).toHaveBeenCalledWith({
      yes: true,
      dryRun: true,
      agentHooks: true,
      projectRoot: "/tmp/commander-shape",
    });
  });

  it("delegates thrown errors to handleError without re-throwing", async () => {
    vi.mocked(runInstallReactDoctor).mockRejectedValueOnce(new Error("boom"));
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
