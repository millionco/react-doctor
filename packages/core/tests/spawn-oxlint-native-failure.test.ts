import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV } from "../src/constants.js";
import { spawnOxlint } from "../src/runners/oxlint/spawn-oxlint.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("required native Oxlint exit handling", () => {
  it.each([
    "process.exit(2)",
    "process.stdout.write(JSON.stringify({ diagnostics: [] })); process.exitCode = 2",
  ])("rejects unsuccessful child exits: %s", async (script) => {
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, "1");

    await expect(
      spawnOxlint(["-e", script], process.cwd(), process.execPath),
    ).rejects.toMatchObject({
      reason: {
        _tag: "OxlintSpawnFailed",
        cause: "Required native Oxlint exited with code 2",
      },
    });
  });

  it("includes stderr in the failure", async () => {
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, "1");

    await expect(
      spawnOxlint(
        ["-e", 'process.stderr.write("native failure"); process.exitCode = 2'],
        process.cwd(),
        process.execPath,
      ),
    ).rejects.toMatchObject({
      reason: {
        _tag: "OxlintSpawnFailed",
        cause: "Required native Oxlint exited with code 2: native failure",
      },
    });
  });

  it.each([0, 1])("preserves diagnostic output for exit code %s", async (exitCode) => {
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, "1");
    const output = JSON.stringify({ diagnostics: [] });

    await expect(
      spawnOxlint(
        ["-e", `process.stdout.write(${JSON.stringify(output)}); process.exitCode = ${exitCode}`],
        process.cwd(),
        process.execPath,
      ),
    ).resolves.toBe(output);
  });

  it.each([
    "process.exit(0)",
    "process.exit(1)",
    'process.stdout.write(" "); process.exitCode = 0',
    'process.stdout.write(" "); process.exitCode = 1',
  ])("rejects missing diagnostic output: %s", async (script) => {
    vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, "1");

    await expect(
      spawnOxlint(["-e", script], process.cwd(), process.execPath),
    ).rejects.toMatchObject({
      reason: {
        _tag: "OxlintSpawnFailed",
        cause: "Required native Oxlint returned empty output.",
      },
    });
  });

  it.each([0, 1, 2])(
    "preserves optional native and stable engine exit handling for code %s",
    async (exitCode) => {
      vi.stubEnv(REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV, undefined);

      await expect(
        spawnOxlint(["-e", `process.exit(${exitCode})`], process.cwd(), process.execPath),
      ).resolves.toBe("");
    },
  );
});
