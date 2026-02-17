import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { selectProjects } from "../src/utils/select-projects.js";

interface WorkspacePackageDefinition {
  name: string;
  reactDependency: boolean;
}

interface WorkspaceFixtureDefinition {
  rootName: string;
  rootReactDependency: boolean;
  workspacePackages: WorkspacePackageDefinition[];
}

const temporaryDirectories: string[] = [];

const createWorkspaceFixture = (definition: WorkspaceFixtureDefinition): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-select-projects-"));

  const rootDependencies = definition.rootReactDependency ? { react: "^19.0.0" } : {};
  fs.writeFileSync(
    path.join(rootDirectory, "package.json"),
    JSON.stringify(
      {
        name: definition.rootName,
        workspaces: ["packages/*"],
        dependencies: rootDependencies,
      },
      null,
      2,
    ),
  );

  for (const workspacePackage of definition.workspacePackages) {
    const workspaceDirectory = path.join(rootDirectory, "packages", workspacePackage.name);
    fs.mkdirSync(workspaceDirectory, { recursive: true });

    const workspaceDependencies = workspacePackage.reactDependency ? { react: "^19.0.0" } : {};
    fs.writeFileSync(
      path.join(workspaceDirectory, "package.json"),
      JSON.stringify(
        {
          name: workspacePackage.name,
          dependencies: workspaceDependencies,
        },
        null,
        2,
      ),
    );
  }

  temporaryDirectories.push(rootDirectory);
  return rootDirectory;
};

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

describe("selectProjects", () => {
  it("includes root package even when workspace candidates exist", async () => {
    const rootDirectory = createWorkspaceFixture({
      rootName: "workspace-root",
      rootReactDependency: true,
      workspacePackages: [{ name: "workspace-app", reactDependency: true }],
    });
    const workspaceDirectory = path.join(rootDirectory, "packages", "workspace-app");

    const selectedDirectories = await selectProjects(rootDirectory, undefined, true);

    expect(selectedDirectories).toContain(workspaceDirectory);
    expect(selectedDirectories).toContain(rootDirectory);
  });

  it("resolves root package with --project", async () => {
    const rootDirectory = createWorkspaceFixture({
      rootName: "workspace-root",
      rootReactDependency: true,
      workspacePackages: [{ name: "workspace-app", reactDependency: true }],
    });

    const selectedDirectories = await selectProjects(rootDirectory, "workspace-root", true);

    expect(selectedDirectories).toEqual([rootDirectory]);
  });

  it("does not include root package when root has no React dependency", async () => {
    const rootDirectory = createWorkspaceFixture({
      rootName: "workspace-root",
      rootReactDependency: false,
      workspacePackages: [{ name: "workspace-app", reactDependency: true }],
    });
    const workspaceDirectory = path.join(rootDirectory, "packages", "workspace-app");

    const selectedDirectories = await selectProjects(rootDirectory, undefined, true);

    expect(selectedDirectories).toEqual([workspaceDirectory]);
  });
});
