import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createProjectGraph } from "../../src/core/project-graph.js";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "react-doctor-project-ownership-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
};

const writePackageJson = (directory: string, packageJson: object): void => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(packageJson));
};

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("createProjectGraph ownership", () => {
  it("selects the deepest discovered React workspace for a file", () => {
    const rootDirectory = createTemporaryDirectory();
    const appDirectory = path.join(rootDirectory, "packages", "app");
    const featureDirectory = path.join(appDirectory, "features", "admin");

    writePackageJson(rootDirectory, {
      name: "root",
      workspaces: ["packages/app", "packages/app/features/admin"],
      dependencies: { react: "^19.0.0" },
    });
    writePackageJson(appDirectory, {
      name: "app",
      dependencies: { react: "^19.0.0" },
    });
    writePackageJson(featureDirectory, {
      name: "admin",
      dependencies: { react: "^19.0.0" },
    });

    const projectGraph = createProjectGraph({ roots: [rootDirectory] });
    const featureFilePath = path.join(featureDirectory, "src", "page.tsx");
    const normalizedRootDirectory = rootDirectory.replaceAll(path.sep, "/");
    const normalizedAppDirectory = appDirectory.replaceAll(path.sep, "/");
    const normalizedFeatureDirectory = featureDirectory.replaceAll(path.sep, "/");

    expect(projectGraph.listProjects()).toEqual([
      { name: "admin", directory: normalizedFeatureDirectory },
      { name: "app", directory: normalizedAppDirectory },
      { name: "root", directory: normalizedRootDirectory },
    ]);
    expect(projectGraph.resolveOwningProject(featureFilePath)).toBe(normalizedFeatureDirectory);
  });
});
