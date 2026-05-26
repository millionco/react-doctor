import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  diagnose,
  diagnoseModules,
  NoReactDependencyError,
  ProjectNotFoundError,
} from "../src/index.js";

const FIXTURES_DIRECTORY = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "core",
  "tests",
  "fixtures",
);

const noReactTempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rdc-api-test-"));
fs.writeFileSync(
  path.join(noReactTempDirectory, "package.json"),
  JSON.stringify({ name: "no-react", dependencies: {} }),
);

afterAll(() => {
  fs.rmSync(noReactTempDirectory, { recursive: true, force: true });
});

describe("diagnose", () => {
  it("returns a DiagnoseResult with the expected shape on basic-react", async () => {
    const result = await diagnose(path.join(FIXTURES_DIRECTORY, "basic-react"), {
      deadCode: false,
      lint: false,
    });
    expect(result).toHaveProperty("diagnostics");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("project");
    expect(result).toHaveProperty("skippedChecks");
    expect(result).toHaveProperty("elapsedMilliseconds");
    expect(result.project.reactMajorVersion).toBe(19);
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it("throws NoReactDependencyError when the directory has package.json without react", async () => {
    await expect(diagnose(noReactTempDirectory, { lint: false })).rejects.toThrow(
      NoReactDependencyError,
    );
  });

  it("throws ProjectNotFoundError when the directory has no package.json and no React subprojects", async () => {
    const emptyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rdc-empty-"));
    try {
      await expect(diagnose(emptyDirectory, { lint: false })).rejects.toThrow(ProjectNotFoundError);
    } finally {
      fs.rmSync(emptyDirectory, { recursive: true, force: true });
    }
  });

  it("elapsedMilliseconds is non-negative", async () => {
    const result = await diagnose(path.join(FIXTURES_DIRECTORY, "basic-react"), {
      deadCode: false,
      lint: false,
    });
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
  });
});

describe("diagnoseModules", () => {
  it("returns per-module results for multiple directories", async () => {
    const result = await diagnoseModules(
      [
        { directory: path.join(FIXTURES_DIRECTORY, "basic-react") },
        { directory: path.join(FIXTURES_DIRECTORY, "nextjs-app") },
      ],
      { deadCode: false, lint: false },
    );

    expect(result.modules).toHaveLength(2);
    expect(result).toHaveProperty("diagnostics");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("elapsedMilliseconds");
    expect(Array.isArray(result.diagnostics)).toBe(true);

    for (const moduleResult of result.modules) {
      expect(moduleResult).toHaveProperty("directory");
      expect(moduleResult).toHaveProperty("diagnostics");
      expect(moduleResult).toHaveProperty("score");
      expect(moduleResult).toHaveProperty("project");
      expect(moduleResult).toHaveProperty("skippedChecks");
      expect(moduleResult).toHaveProperty("elapsedMilliseconds");
    }
  });

  it("flattens diagnostics across all modules", async () => {
    const result = await diagnoseModules(
      [
        { directory: path.join(FIXTURES_DIRECTORY, "basic-react") },
        { directory: path.join(FIXTURES_DIRECTORY, "nextjs-app") },
      ],
      { deadCode: false, lint: false },
    );

    const expectedTotal = result.modules.reduce(
      (sum, moduleResult) => sum + moduleResult.diagnostics.length,
      0,
    );
    expect(result.diagnostics).toHaveLength(expectedTotal);
  });

  it("supports per-module config overrides", async () => {
    const result = await diagnoseModules(
      [
        { directory: path.join(FIXTURES_DIRECTORY, "basic-react"), config: { deadCode: false } },
        { directory: path.join(FIXTURES_DIRECTORY, "nextjs-app"), config: { deadCode: false } },
      ],
      { lint: false },
    );

    expect(result.modules).toHaveLength(2);
    for (const moduleResult of result.modules) {
      expect(moduleResult.skippedChecks).not.toContain("dead-code");
    }
  });

  it("respects concurrency: 1 for sequential execution", async () => {
    const result = await diagnoseModules(
      [
        { directory: path.join(FIXTURES_DIRECTORY, "basic-react") },
        { directory: path.join(FIXTURES_DIRECTORY, "nextjs-app") },
      ],
      { deadCode: false, lint: false, concurrency: 1 },
    );

    expect(result.modules).toHaveLength(2);
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
  });

  it("handles a single module identically to diagnose()", async () => {
    const singleModuleResult = await diagnoseModules(
      [{ directory: path.join(FIXTURES_DIRECTORY, "basic-react") }],
      { deadCode: false, lint: false },
    );
    const directResult = await diagnose(path.join(FIXTURES_DIRECTORY, "basic-react"), {
      deadCode: false,
      lint: false,
    });

    expect(singleModuleResult.modules).toHaveLength(1);
    expect(singleModuleResult.errors).toHaveLength(0);
    expect(singleModuleResult.modules[0].project.reactMajorVersion).toBe(
      directResult.project.reactMajorVersion,
    );
    expect(singleModuleResult.modules[0].project.projectName).toBe(
      directResult.project.projectName,
    );
  });

  it("collects failing modules into errors without aborting the batch", async () => {
    const result = await diagnoseModules(
      [
        { directory: path.join(FIXTURES_DIRECTORY, "basic-react") },
        { directory: noReactTempDirectory },
      ],
      { deadCode: false, lint: false },
    );

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].project.projectName).toBe("test-basic-react");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].directory).toBe(noReactTempDirectory);
    expect(result.errors[0].error).toBeInstanceOf(Error);
  });

  it("returns empty results for an empty modules array", async () => {
    const result = await diagnoseModules([], { deadCode: false, lint: false });

    expect(result.modules).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.score).toBeNull();
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
  });

  it("clamps concurrency: 0 to 1 without hanging", async () => {
    const result = await diagnoseModules(
      [{ directory: path.join(FIXTURES_DIRECTORY, "basic-react") }],
      { deadCode: false, lint: false, concurrency: 0 },
    );

    expect(result.modules).toHaveLength(1);
  });

  it("accepts per-module reactDoctorConfig override", async () => {
    const result = await diagnoseModules(
      [
        {
          directory: path.join(FIXTURES_DIRECTORY, "basic-react"),
          config: {
            deadCode: false,
            reactDoctorConfig: { ignore: { tags: ["design"] } },
          },
        },
      ],
      { lint: false },
    );

    expect(result.modules).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });
});
