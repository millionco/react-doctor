import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { AmbiguousProjectError, resolveScanTarget } from "../src/index.js";

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
});
