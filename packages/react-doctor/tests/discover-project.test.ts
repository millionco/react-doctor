import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  discoverProject,
  discoverReactSubprojects,
  formatFrameworkName,
  listWorkspacePackages,
} from "../src/utils/discover-project.js";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures");
const VALID_FRAMEWORKS = ["nextjs", "vite", "cra", "remix", "gatsby", "unknown"];

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-discover-test-"));

afterAll(() => {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("discoverProject", () => {
  it("detects React version from package.json", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"));
    expect(projectInfo.reactVersion).toBe("^19.0.0");
  });

  it("returns a valid framework", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"));
    expect(VALID_FRAMEWORKS).toContain(projectInfo.framework);
  });

  it("detects TypeScript when tsconfig.json exists", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"));
    expect(projectInfo.hasTypeScript).toBe(true);
  });

  it("detects React version from peerDependencies", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "component-library"));
    expect(projectInfo.reactVersion).toBe("^18.0.0 || ^19.0.0");
  });

  it("throws when package.json is missing", () => {
    expect(() => discoverProject("/nonexistent/path")).toThrow("No package.json found");
  });

  it("throws when package.json is a directory instead of a file", () => {
    const projectDirectory = path.join(tempDirectory, "eisdir-root");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.mkdirSync(path.join(projectDirectory, "package.json"), { recursive: true });

    expect(() => discoverProject(projectDirectory)).toThrow("No package.json found");
  });

  describe("with packageJsonDirectory", () => {
    const sourceDirectory = path.join(FIXTURES_DIRECTORY, "split-project", "source");
    const metadataDirectory = path.join(FIXTURES_DIRECTORY, "split-project", "metadata");

    it("reads package.json from the custom directory", () => {
      const projectInfo = discoverProject(sourceDirectory, metadataDirectory);
      expect(projectInfo.reactVersion).toBe("^19.0.0");
      expect(projectInfo.projectName).toBe("test-split-project");
    });

    it("detects tsconfig from the scan directory, not the package.json directory", () => {
      const projectInfo = discoverProject(sourceDirectory, metadataDirectory);
      expect(projectInfo.hasTypeScript).toBe(true);
    });

    it("uses the scan directory as rootDirectory", () => {
      const projectInfo = discoverProject(sourceDirectory, metadataDirectory);
      expect(projectInfo.rootDirectory).toBe(sourceDirectory);
    });

    it("throws when the custom directory has no package.json", () => {
      expect(() => discoverProject(sourceDirectory, "/nonexistent/path")).toThrow(
        "No package.json found",
      );
    });

    it("falls back to scan directory when packageJsonDirectory is undefined", () => {
      const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"), undefined);
      expect(projectInfo.reactVersion).toBe("^19.0.0");
    });
  });
});

describe("listWorkspacePackages", () => {
  it("returns empty when packageJsonDirectory has no package.json", () => {
    const packages = listWorkspacePackages("/some/root", "/nonexistent/path");
    expect(packages).toEqual([]);
  });

  it("returns empty when packageJsonDirectory has no workspaces", () => {
    const metadataDirectory = path.join(FIXTURES_DIRECTORY, "split-project", "metadata");
    const packages = listWorkspacePackages("/some/root", metadataDirectory);
    expect(packages).toEqual([]);
  });

  it("falls back to rootDirectory when packageJsonDirectory is undefined", () => {
    const packages = listWorkspacePackages(path.join(FIXTURES_DIRECTORY, "basic-react"));
    expect(packages).toEqual([]);
  });

  it("resolves nested workspace patterns like apps/*/ClientApp", () => {
    const packages = listWorkspacePackages(path.join(FIXTURES_DIRECTORY, "nested-workspaces"));
    const packageNames = packages.map((workspacePackage) => workspacePackage.name);

    expect(packageNames).toContain("my-app-client");
    expect(packageNames).toContain("ui");
    expect(packages).toHaveLength(2);
  });
});

describe("discoverReactSubprojects", () => {
  it("skips subdirectories where package.json is a directory (EISDIR)", () => {
    const rootDirectory = path.join(tempDirectory, "eisdir-package-json");
    const subdirectory = path.join(rootDirectory, "broken-sub");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );
    fs.mkdirSync(subdirectory, { recursive: true });
    fs.mkdirSync(path.join(subdirectory, "package.json"), { recursive: true });

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("my-app");
  });

  it("includes root directory when it has a react dependency", () => {
    const rootDirectory = path.join(tempDirectory, "root-with-react");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toContainEqual({ name: "my-app", directory: rootDirectory });
  });

  it("includes both root and subdirectory when both have react", () => {
    const rootDirectory = path.join(tempDirectory, "root-and-sub");
    const subdirectory = path.join(rootDirectory, "extension");
    fs.mkdirSync(subdirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );
    fs.writeFileSync(
      path.join(subdirectory, "package.json"),
      JSON.stringify({ name: "my-extension", dependencies: { react: "^18.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(2);
    expect(packages[0]).toEqual({ name: "my-app", directory: rootDirectory });
    expect(packages[1]).toEqual({ name: "my-extension", directory: subdirectory });
  });

  it("does not match packages with only @types/react", () => {
    const rootDirectory = path.join(tempDirectory, "types-only");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "types-only", devDependencies: { "@types/react": "^18.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(0);
  });

  it("matches packages with react-native dependency", () => {
    const rootDirectory = path.join(tempDirectory, "rn-app");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "rn-app", dependencies: { "react-native": "^0.74.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(1);
  });

  it("returns empty when packageJsonDirectory does not exist", () => {
    const packages = discoverReactSubprojects("/some/root", "/nonexistent/path");
    expect(packages).toEqual([]);
  });

  it("scans the packageJsonDirectory for subprojects instead of rootDirectory", () => {
    const packages = discoverReactSubprojects("/nonexistent/root", FIXTURES_DIRECTORY);
    const names = packages.map((p) => p.name);
    expect(names).toContain("test-basic-react");
  });

  it("falls back to rootDirectory when packageJsonDirectory is undefined", () => {
    const packages = discoverReactSubprojects(FIXTURES_DIRECTORY);
    const names = packages.map((p) => p.name);
    expect(names).toContain("test-basic-react");
  });
});

describe("formatFrameworkName", () => {
  it("formats known frameworks", () => {
    expect(formatFrameworkName("nextjs")).toBe("Next.js");
    expect(formatFrameworkName("vite")).toBe("Vite");
    expect(formatFrameworkName("cra")).toBe("Create React App");
    expect(formatFrameworkName("remix")).toBe("Remix");
    expect(formatFrameworkName("gatsby")).toBe("Gatsby");
  });

  it("formats unknown framework as React", () => {
    expect(formatFrameworkName("unknown")).toBe("React");
  });
});
