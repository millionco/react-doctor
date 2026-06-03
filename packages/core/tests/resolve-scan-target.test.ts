import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { AmbiguousProjectError, ProjectNotFoundError, resolveScanTarget } from "../src/index.js";

const tempDirectories: string[] = [];

const createTempDirectory = (): string => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-resolve-target-"));
  tempDirectories.push(tempDirectory);
  return tempDirectory;
};

const writeJson = (filePath: string, contents: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(contents, null, 2));
};

const writeReactProject = (parentDirectory: string, projectName: string): string => {
  const projectDirectory = path.join(parentDirectory, projectName);
  writeJson(path.join(projectDirectory, "package.json"), {
    name: projectName,
    dependencies: {
      react: "^19.0.0",
      "react-dom": "^19.0.0",
    },
  });
  return projectDirectory;
};

describe("resolveScanTarget", () => {
  afterEach(() => {
    for (const tempDirectory of tempDirectories.splice(0)) {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("can keep an ambiguous wrapper directory for multi-project CLI scans", async () => {
    const wrapperDirectory = createTempDirectory();
    writeReactProject(wrapperDirectory, "frontend");
    writeReactProject(wrapperDirectory, "mobile");

    await expect(resolveScanTarget(wrapperDirectory)).rejects.toThrow(AmbiguousProjectError);

    const scanTarget = await resolveScanTarget(wrapperDirectory, { allowAmbiguous: true });
    expect(scanTarget.resolvedDirectory).toBe(wrapperDirectory);
  });

  it("reports a missing scan target as a non-existent path, not a missing package.json", async () => {
    // REACT-DOCTOR-4: a scan target that doesn't exist on disk (a typo or a
    // stale path) is user input, and the "expected a package.json" guidance is
    // misleading — the path simply isn't there.
    const missingDirectory = path.join(createTempDirectory(), "does-not-exist");

    const rejection = await resolveScanTarget(missingDirectory).then(
      () => null,
      (error: unknown) => error,
    );

    if (!(rejection instanceof ProjectNotFoundError)) {
      throw new Error(`Expected ProjectNotFoundError, got ${String(rejection)}`);
    }
    expect(rejection.kind).toBe("missing-path");
    expect(rejection.message).toContain("does not exist");
    expect(rejection.message).not.toContain("package.json");
  });
});
