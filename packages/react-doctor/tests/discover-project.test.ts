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

  it("resolves React version from the default pnpm workspace catalog", () => {
    const rootDirectory = path.join(tempDirectory, "pnpm-default-catalog");
    const appDirectory = path.join(rootDirectory, "packages", "app");
    fs.mkdirSync(appDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "workspace-root", private: true }),
    );
    fs.writeFileSync(
      path.join(rootDirectory, "pnpm-workspace.yaml"),
      [
        "packages:",
        '  - "packages/*"',
        "catalog:",
        '  react: "^19.1.0"',
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: { react: "catalog:", vite: "^7.1.0" },
      }),
    );

    const projectInfo = discoverProject(appDirectory);
    expect(projectInfo.reactVersion).toBe("^19.1.0");
    expect(projectInfo.framework).toBe("vite");
  });

  it("resolves React version from a named pnpm workspace catalog", () => {
    const rootDirectory = path.join(tempDirectory, "pnpm-named-catalog");
    const appDirectory = path.join(rootDirectory, "packages", "app");
    fs.mkdirSync(appDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "workspace-root", private: true }),
    );
    fs.writeFileSync(
      path.join(rootDirectory, "pnpm-workspace.yaml"),
      [
        "packages:",
        '  - "packages/*"',
        "catalogs:",
        "  react19:",
        '    react: "^19.2.0"',
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: { react: "catalog:react19", vite: "^7.1.0" },
      }),
    );

    const projectInfo = discoverProject(appDirectory);
    expect(projectInfo.reactVersion).toBe("^19.2.0");
    expect(projectInfo.framework).toBe("vite");
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
});

describe("listWorkspacePackages", () => {
  it("resolves nested workspace patterns like apps/*/ClientApp", () => {
    const packages = listWorkspacePackages(path.join(FIXTURES_DIRECTORY, "nested-workspaces"));
    const packageNames = packages.map((workspacePackage) => workspacePackage.name);

    expect(packageNames).toContain("my-app-client");
    expect(packageNames).toContain("ui");
    expect(packages).toHaveLength(2);
  });
});

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-discover-test-"));

afterAll(() => {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
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
