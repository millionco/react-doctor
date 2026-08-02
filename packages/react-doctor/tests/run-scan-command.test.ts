import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../src/cli/commands/inspect.js", () => ({
  inspectAction: vi.fn(async () => {}),
}));

vi.mock("../src/cli/utils/cli-migrations.js", () => ({
  runProjectMigrations: vi.fn(async () => []),
}));

vi.mock("../src/cli/ink/run-scan-app.js", () => ({
  runScanApp: vi.fn(async () => ({ shouldFail: false })),
}));

vi.mock("../src/cli/utils/is-non-interactive-environment.js", () => ({
  isNonInteractiveEnvironment: vi.fn(() => false),
}));

vi.mock("../src/cli/utils/record-metric.js", () => ({
  recordCount: vi.fn(),
}));

vi.mock("../src/cli/utils/resolve-cli-inspect-options.js", () => ({
  resolveCliInspectOptions: vi.fn(() => ({ noScore: true })),
}));

vi.mock("../src/cli/utils/should-use-tui.js", () => ({
  shouldUseTui: vi.fn(() => true),
}));

vi.mock("@react-doctor/core", () => ({
  resolveScanTarget: vi.fn(async (directory: string) => ({
    resolvedDirectory: directory,
    requestedDirectory: directory,
    userConfig: null,
    configSourceDirectory: null,
    didRedirectViaRootDir: false,
  })),
}));

import { resolveScanTarget } from "@react-doctor/core";
import { inspectAction } from "../src/cli/commands/inspect.js";
import { runScanCommand } from "../src/cli/commands/scan.js";
import { runScanApp } from "../src/cli/ink/run-scan-app.js";
import { runProjectMigrations } from "../src/cli/utils/cli-migrations.js";
import { METRIC } from "../src/cli/utils/constants.js";
import { recordCount } from "../src/cli/utils/record-metric.js";
import { resolveCliInspectOptions } from "../src/cli/utils/resolve-cli-inspect-options.js";
import { shouldUseTui } from "../src/cli/utils/should-use-tui.js";

describe("runScanCommand", () => {
  const previousExitCode = process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shouldUseTui).mockReturnValue(true);
    vi.mocked(runScanApp).mockResolvedValue({ shouldFail: false });
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it("runs the interactive report with the root scan flags", async () => {
    const flags = { blocking: "warning", project: "app", score: false, yes: true };

    await runScanCommand({ directory: "/tmp/project", flags, invocationCommand: "inspect" });

    expect(resolveCliInspectOptions).toHaveBeenCalledWith(flags, null);
    expect(runScanApp).toHaveBeenCalledWith({
      directory: "/tmp/project",
      scanTarget: {
        resolvedDirectory: "/tmp/project",
        requestedDirectory: "/tmp/project",
        userConfig: null,
        configSourceDirectory: null,
        didRedirectViaRootDir: false,
      },
      options: { noScore: true },
      projectFlag: "app",
      skipPrompts: true,
      blocking: "warning",
    });
    expect(recordCount).toHaveBeenCalledWith(METRIC.cliInvoked, 1, { command: "inspect" });
    expect(resolveScanTarget).toHaveBeenCalledWith("/tmp/project", { allowAmbiguous: true });
    expect(runProjectMigrations).toHaveBeenCalledWith(path.resolve("/tmp/project"));
    expect(inspectAction).not.toHaveBeenCalled();
  });

  it("uses the stable renderer when project config requires diff semantics", async () => {
    vi.mocked(shouldUseTui).mockReturnValueOnce(true).mockReturnValueOnce(false);
    const flags = {};

    await runScanCommand({ directory: "/tmp/project", flags, invocationCommand: "inspect" });

    expect(runProjectMigrations).toHaveBeenCalledWith(path.resolve("/tmp/project"));
    expect(inspectAction).toHaveBeenCalledWith("/tmp/project", flags, "inspect");
    expect(runScanApp).not.toHaveBeenCalled();
    expect(recordCount).not.toHaveBeenCalled();
  });

  it("uses the stable renderer when the TUI gate rejects the environment or flags", async () => {
    vi.mocked(shouldUseTui).mockReturnValue(false);
    const flags = { json: true };

    await runScanCommand({ directory: "/tmp/project", flags, invocationCommand: "inspect" });

    expect(inspectAction).toHaveBeenCalledWith("/tmp/project", flags, "inspect");
    expect(runScanApp).not.toHaveBeenCalled();
    expect(runProjectMigrations).not.toHaveBeenCalled();
    expect(recordCount).not.toHaveBeenCalled();
  });

  it("preserves the TUI scan exit code", async () => {
    vi.mocked(runScanApp).mockResolvedValue({ shouldFail: true });

    await runScanCommand({ directory: "/tmp/project", flags: {}, invocationCommand: "inspect" });

    expect(process.exitCode).toBe(1);
  });
});
