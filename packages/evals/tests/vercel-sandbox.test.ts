import { Sandbox, Snapshot } from "@vercel/sandbox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { executeSandboxCommand } from "../src/execute-sandbox-command.js";
import { createEvaluationSandbox } from "../src/utils/create-evaluation-sandbox.js";
import { createEvaluationSnapshot } from "../src/utils/create-evaluation-snapshot.js";
import { getSandboxCredentials } from "../src/utils/get-sandbox-credentials.js";
import { readSandboxFile } from "../src/utils/read-sandbox-file.js";
import {
  SANDBOX_IMAGE,
  SANDBOX_SNAPSHOT_EXPIRATION_MS,
  PREPARE_SANDBOX_COMMAND,
} from "../src/constants.js";

const TEST_TIMEOUT_SECONDS = 30;
const TEST_DEADLINE_MS = 60_000;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const createSandbox = () => {
  const sandbox = Object.create(Sandbox.prototype);
  const runCommand = vi.fn(async () => ({
    exitCode: 0,
    stdout: async () => "output",
    stderr: async () => "",
  }));
  const snapshot = Object.create(Snapshot.prototype);
  const createSnapshot = vi.fn(async () => snapshot);
  const deleteSandbox = vi.fn(async () => undefined);
  Object.defineProperties(sandbox, {
    runCommand: { value: runCommand },
    snapshot: { value: createSnapshot },
    delete: { value: deleteSandbox },
  });
  return { sandbox, runCommand, snapshot, createSnapshot, deleteSandbox };
};

describe("Vercel Sandbox evaluation", () => {
  it("restores the requested CPU allocation and prepares Oxlint memory reservations", async () => {
    const { sandbox, runCommand } = createSandbox();
    vi.spyOn(Sandbox, "create").mockResolvedValue(sandbox);
    expect(
      await createEvaluationSandbox({
        credentials: {},
        name: "scan",
        evaluationId: "run",
        snapshotId: "snapshot",
        cpuCores: 4,
        deadlineMilliseconds: performance.now() + TEST_DEADLINE_MS,
      }),
    ).toBe(sandbox);
    expect(Sandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { type: "snapshot", snapshotId: "snapshot" },
        resources: { vcpus: 4 },
        persistent: false,
      }),
    );
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ env: {}, args: expect.arrayContaining([PREPARE_SANDBOX_COMMAND]) }),
    );
  });

  it("bounds execution inside the VM and passes only the explicit command environment", async () => {
    const { sandbox, runCommand } = createSandbox();
    const result = await executeSandboxCommand({
      sandbox,
      command: "printf test",
      environment: { TEST: "value" },
      timeoutSeconds: TEST_TIMEOUT_SECONDS,
      description: "test",
    });
    expect(result).toEqual({ exitCode: 0, output: "output" });
    expect(runCommand).toHaveBeenCalledWith({
      cmd: "timeout",
      args: ["--signal=KILL", "30s", "bash", "-c", "printf test"],
      env: { TEST: "value" },
      signal: expect.any(AbortSignal),
    });
  });
  it("rejects a nonzero command with stderr", async () => {
    const { sandbox, runCommand } = createSandbox();
    runCommand.mockResolvedValue({
      exitCode: 1,
      stdout: async () => "",
      stderr: async () => "build failed",
    });
    await expect(
      executeSandboxCommand({
        sandbox,
        command: "false",
        environment: {},
        timeoutSeconds: TEST_TIMEOUT_SECONDS,
        description: "build",
      }),
    ).rejects.toThrow("build failed");
  });
  it("rejects a missing file instead of accepting an empty report", async () => {
    const { sandbox } = createSandbox();
    const readFileToBuffer = vi.fn(async () => null);
    Object.defineProperty(sandbox, "readFileToBuffer", { value: readFileToBuffer });
    await expect(readSandboxFile(sandbox, "/missing", TEST_TIMEOUT_SECONDS)).rejects.toThrow(
      "Sandbox file is missing",
    );
    expect(readFileToBuffer).toHaveBeenCalledWith(
      { path: "/missing" },
      { signal: expect.any(AbortSignal) },
    );
  });
  it("creates an expiring snapshot and deletes the builder", async () => {
    const { sandbox, snapshot, createSnapshot, deleteSandbox } = createSandbox();
    vi.spyOn(Sandbox, "create").mockResolvedValue(sandbox);
    const result = await createEvaluationSnapshot(
      {
        name: "builder",
        evaluationId: "run",
        credentials: {},
        resources: { cpu: 2 },
        build: { environment: {}, commands: ["echo test"] },
      },
      performance.now() + TEST_DEADLINE_MS,
    );
    expect(result).toBe(snapshot);
    expect(Sandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        image: SANDBOX_IMAGE,
        persistent: false,
        resources: { vcpus: 2 },
        tags: { evaluation: "run" },
      }),
    );
    expect(createSnapshot).toHaveBeenCalledWith({
      expiration: SANDBOX_SNAPSHOT_EXPIRATION_MS,
      signal: expect.any(AbortSignal),
    });
    expect(deleteSandbox).toHaveBeenCalledOnce();
  });
  it("deletes the builder after a failed build", async () => {
    const { sandbox, runCommand, createSnapshot, deleteSandbox } = createSandbox();
    vi.spyOn(Sandbox, "create").mockResolvedValue(sandbox);
    runCommand.mockRejectedValue(new Error("build failed"));
    await expect(
      createEvaluationSnapshot(
        {
          name: "builder",
          evaluationId: "run",
          credentials: {},
          resources: { cpu: 2 },
          build: { environment: {}, commands: ["false"] },
        },
        performance.now() + TEST_DEADLINE_MS,
      ),
    ).rejects.toThrow("build failed");
    expect(createSnapshot).not.toHaveBeenCalled();
    expect(deleteSandbox).toHaveBeenCalledOnce();
  });
  it("supports a complete token tuple and the existing organization alias", () => {
    vi.stubEnv("VERCEL_TOKEN", "test-token");
    vi.stubEnv("VERCEL_TEAM_ID", "");
    vi.stubEnv("VERCEL_ORG_ID", "team-id");
    vi.stubEnv("VERCEL_PROJECT_ID", "project-id");
    expect(getSandboxCredentials()).toEqual({
      token: "test-token",
      teamId: "team-id",
      projectId: "project-id",
    });
  });
  it("uses OIDC when an explicit token tuple is incomplete", () => {
    vi.stubEnv("VERCEL_TOKEN", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "test-oidc");
    expect(getSandboxCredentials()).toEqual({});
  });
  it("rejects missing credentials", () => {
    vi.stubEnv("VERCEL_TOKEN", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    expect(() => getSandboxCredentials()).toThrow("Set VERCEL_OIDC_TOKEN");
  });
});
