import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  diagnose,
  diagnoseProjects,
  NoReactDependencyError,
  NotADirectoryError,
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

  it("throws NotADirectoryError when the path is a file instead of a directory", async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rdc-file-"));
    const filePath = path.join(tempDirectory, "not-a-directory.txt");
    fs.writeFileSync(filePath, "");
    try {
      await expect(diagnose(filePath, { lint: false })).rejects.toThrow(NotADirectoryError);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
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

describe("diagnoseProjects", () => {
  it("returns per-project results for multiple directories", async () => {
    const result = await diagnoseProjects({
      projects: [
        { directory: path.join(FIXTURES_DIRECTORY, "basic-react") },
        { directory: path.join(FIXTURES_DIRECTORY, "nextjs-app") },
      ],
      deadCode: false,
      lint: false,
    });

    expect(result.projects).toHaveLength(2);
    expect(result).toHaveProperty("diagnostics");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("elapsedMilliseconds");
    expect(Array.isArray(result.diagnostics)).toBe(true);

    for (const projectResult of result.projects) {
      expect(projectResult.ok).toBe(true);
      if (!projectResult.ok) continue;
      expect(projectResult).toHaveProperty("directory");
      expect(projectResult).toHaveProperty("diagnostics");
      expect(projectResult).toHaveProperty("score");
      expect(projectResult).toHaveProperty("project");
      expect(projectResult).toHaveProperty("skippedChecks");
      expect(projectResult).toHaveProperty("elapsedMilliseconds");
    }
  });

  it("flattens diagnostics across all succeeded projects", async () => {
    const result = await diagnoseProjects({
      projects: [
        { directory: path.join(FIXTURES_DIRECTORY, "basic-react") },
        { directory: path.join(FIXTURES_DIRECTORY, "nextjs-app") },
      ],
      deadCode: false,
      lint: false,
    });

    const expectedTotal = result.projects.reduce(
      (sum, projectResult) => sum + (projectResult.ok ? projectResult.diagnostics.length : 0),
      0,
    );
    expect(result.diagnostics).toHaveLength(expectedTotal);
  });

  it("supports per-project scan option overrides", async () => {
    const result = await diagnoseProjects({
      projects: [
        { directory: path.join(FIXTURES_DIRECTORY, "basic-react"), deadCode: false },
        { directory: path.join(FIXTURES_DIRECTORY, "nextjs-app"), deadCode: false },
      ],
      lint: false,
    });

    expect(result.projects).toHaveLength(2);
    for (const projectResult of result.projects) {
      expect(projectResult.ok).toBe(true);
      if (!projectResult.ok) continue;
      expect(projectResult.skippedChecks).not.toContain("dead-code");
    }
  });

  it("respects concurrency: 1 for sequential execution", async () => {
    const result = await diagnoseProjects({
      projects: [
        { directory: path.join(FIXTURES_DIRECTORY, "basic-react") },
        { directory: path.join(FIXTURES_DIRECTORY, "nextjs-app") },
      ],
      deadCode: false,
      lint: false,
      concurrency: 1,
    });

    expect(result.projects).toHaveLength(2);
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
  });

  it("handles a single project identically to diagnose()", async () => {
    const multiResult = await diagnoseProjects({
      projects: [{ directory: path.join(FIXTURES_DIRECTORY, "basic-react") }],
      deadCode: false,
      lint: false,
    });
    const directResult = await diagnose(path.join(FIXTURES_DIRECTORY, "basic-react"), {
      deadCode: false,
      lint: false,
    });

    expect(multiResult.projects).toHaveLength(1);
    const firstProject = multiResult.projects[0];
    expect(firstProject.ok).toBe(true);
    if (!firstProject.ok) return;
    expect(firstProject.project.reactMajorVersion).toBe(directResult.project.reactMajorVersion);
    expect(firstProject.project.projectName).toBe(directResult.project.projectName);
  });

  it("collects failing projects with ok: false without aborting the batch", async () => {
    const result = await diagnoseProjects({
      projects: [
        { directory: path.join(FIXTURES_DIRECTORY, "basic-react") },
        { directory: noReactTempDirectory },
      ],
      deadCode: false,
      lint: false,
    });

    const succeeded = result.projects.filter((projectResult) => projectResult.ok);
    const failed = result.projects.filter((projectResult) => !projectResult.ok);

    expect(succeeded).toHaveLength(1);
    expect(succeeded[0].ok && succeeded[0].project.projectName).toBe("test-basic-react");
    expect(failed).toHaveLength(1);
    expect(failed[0].directory).toBe(noReactTempDirectory);
    expect(!failed[0].ok && failed[0].error).toBeInstanceOf(Error);
  });

  it("returns empty results for an empty projects array", async () => {
    const result = await diagnoseProjects({ projects: [], deadCode: false, lint: false });

    expect(result.projects).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.score).toBeNull();
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
  });

  it("clamps concurrency: 0 to 1 without hanging", async () => {
    const result = await diagnoseProjects({
      projects: [{ directory: path.join(FIXTURES_DIRECTORY, "basic-react") }],
      deadCode: false,
      lint: false,
      concurrency: 0,
    });

    expect(result.projects).toHaveLength(1);
  });

  it("accepts per-project ReactDoctorConfig override", async () => {
    const result = await diagnoseProjects({
      projects: [
        {
          directory: path.join(FIXTURES_DIRECTORY, "basic-react"),
          deadCode: false,
          config: { ignore: { tags: ["design"] } },
        },
      ],
      lint: false,
    });

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].ok).toBe(true);
  });
});
