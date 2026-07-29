import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { discoverReactSubprojects, listWorkspacePackages } from "../src/project-info/index.js";

const FIXTURES_DIRECTORY = path.join(import.meta.dirname, "fixtures");
const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "react-doctor-subproject-parity-"),
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

describe("discoverReactSubprojects manifest parity", () => {
  it.each([
    "nested-workspaces",
    "pnpm-catalog-workspace",
    "pnpm-named-catalog",
    "bun-catalog-workspace",
  ])("matches the legacy manifest package list for %s", (fixtureName) => {
    const rootDirectory = path.join(FIXTURES_DIRECTORY, fixtureName);

    expect(discoverReactSubprojects(rootDirectory)).toEqual(listWorkspacePackages(rootDirectory));
  });

  it("preserves root inclusion, workspace pattern order, and overlap deduplication", () => {
    const rootDirectory = createTemporaryDirectory();
    const secondWorkspaceDirectory = path.join(rootDirectory, "packages", "second");
    const firstWorkspaceDirectory = path.join(rootDirectory, "packages", "first");

    writePackageJson(rootDirectory, {
      name: "workspace-root",
      workspaces: ["packages/second", "packages/first", "packages/*"],
      dependencies: { react: "^19.0.0" },
    });
    writePackageJson(secondWorkspaceDirectory, {
      name: "second",
      dependencies: { react: "catalog:" },
    });
    writePackageJson(firstWorkspaceDirectory, {
      name: "first",
      dependencies: { "react-native": "^0.80.0" },
    });

    expect(discoverReactSubprojects(rootDirectory)).toEqual([
      { name: "workspace-root", directory: rootDirectory },
      { name: "second", directory: secondWorkspaceDirectory },
      { name: "first", directory: firstWorkspaceDirectory },
    ]);
  });

  it("keeps filesystem discovery when a root manifest has no workspace declaration", () => {
    const rootDirectory = createTemporaryDirectory();
    const nestedDirectory = path.join(rootDirectory, "examples", "nested");

    writePackageJson(rootDirectory, {
      name: "standalone-root",
      dependencies: { react: "^19.0.0" },
    });
    writePackageJson(nestedDirectory, {
      name: "nested",
      dependencies: { react: "^18.0.0" },
    });

    expect(discoverReactSubprojects(rootDirectory)).toEqual([
      { name: "standalone-root", directory: rootDirectory },
      { name: "nested", directory: nestedDirectory },
    ]);
  });

  it("keeps package-less Nx discovery ahead of filesystem crawling", () => {
    const rootDirectory = createTemporaryDirectory();
    const workspaceDirectory = path.join(rootDirectory, "apps", "web");
    const unlistedDirectory = path.join(rootDirectory, "examples", "preview");

    fs.writeFileSync(path.join(rootDirectory, "nx.json"), "{}");
    writePackageJson(workspaceDirectory, {
      name: "web",
      dependencies: { react: "^19.0.0" },
    });
    fs.writeFileSync(path.join(workspaceDirectory, "project.json"), "{}");
    writePackageJson(unlistedDirectory, {
      name: "preview",
      dependencies: { react: "^19.0.0" },
    });

    expect(discoverReactSubprojects(rootDirectory)).toEqual([
      { name: "web", directory: workspaceDirectory },
    ]);
  });
});
