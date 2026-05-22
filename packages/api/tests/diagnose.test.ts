import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { diagnose, NoReactDependencyError, ProjectNotFoundError } from "../src/index.js";

const FIXTURES_DIRECTORY = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "react-doctor",
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
