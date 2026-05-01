import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
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

  it("throws when package.json is missing", () => {
    expect(() => discoverProject("/nonexistent/path")).toThrow("No package.json found");
  });

  it("throws when package.json is a directory instead of a file", () => {
    const projectDirectory = path.join(tempDirectory, "eisdir-root");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.mkdirSync(path.join(projectDirectory, "package.json"), { recursive: true });

    expect(() => discoverProject(projectDirectory)).toThrow("No package.json found");
  });

  it("resolves React version from pnpm workspace default catalog", () => {
    const projectInfo = discoverProject(
      path.join(FIXTURES_DIRECTORY, "pnpm-catalog-workspace", "packages", "ui"),
    );
    expect(projectInfo.reactVersion).toBe("^19.0.0");
  });

  it("resolves React version from pnpm workspace named catalog", () => {
    const projectInfo = discoverProject(
      path.join(FIXTURES_DIRECTORY, "pnpm-named-catalog", "packages", "app"),
    );
    expect(projectInfo.reactVersion).toBe("^19.0.0");
  });

  it("resolves React version from Bun workspace catalog", () => {
    const projectInfo = discoverProject(
      path.join(FIXTURES_DIRECTORY, "bun-catalog-workspace", "apps", "web"),
    );
    expect(projectInfo.reactVersion).toBe("^19.1.4");
  });

  it("resolves React version when only in peerDependencies with catalog reference", () => {
    const projectDirectory = path.join(tempDirectory, "peer-deps-catalog");
    const monorepoRoot = path.join(tempDirectory, "peer-deps-catalog-root");
    fs.mkdirSync(path.join(monorepoRoot, "packages", "ui"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n\ncatalog:\n  react: ^19.2.0\n  react-dom: ^19.2.0\n",
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({ name: "monorepo", private: true }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "packages", "ui", "package.json"),
      JSON.stringify({
        name: "ui",
        peerDependencies: { react: "catalog:", "react-dom": "catalog:" },
        devDependencies: { react: "catalog:", "react-dom": "catalog:" },
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "packages", "ui"));
    expect(projectInfo.reactVersion).toBe("^19.2.0");
  });

  it("resolves React when catalog reference name does not exist (falls back to default)", () => {
    const monorepoRoot = path.join(tempDirectory, "nonexistent-catalog-name");
    fs.mkdirSync(path.join(monorepoRoot, "packages", "app"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n\ncatalog:\n  react: ^19.3.0\n",
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({ name: "monorepo", private: true }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "packages", "app", "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: { react: "catalog:nonexistent" },
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "packages", "app"));
    expect(projectInfo.reactVersion).toBe("^19.3.0");
  });

  it("handles empty pnpm-workspace.yaml gracefully", () => {
    const monorepoRoot = path.join(tempDirectory, "empty-workspace-yaml");
    fs.mkdirSync(monorepoRoot, { recursive: true });
    fs.writeFileSync(path.join(monorepoRoot, "pnpm-workspace.yaml"), "");
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({ name: "app", dependencies: { react: "^19.0.0" } }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^19.0.0");
  });

  it("handles malformed package.json gracefully during workspace discovery", () => {
    const monorepoRoot = path.join(tempDirectory, "malformed-workspace-pkg");
    const subDir = path.join(monorepoRoot, "packages", "broken");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({
        name: "monorepo",
        dependencies: { react: "^19.0.0" },
        workspaces: ["packages/*"],
      }),
    );
    fs.writeFileSync(path.join(subDir, "package.json"), "{ invalid json }}}");

    expect(() => discoverProject(monorepoRoot)).not.toThrow();
    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^19.0.0");
  });

  it("does not detect React Compiler when next.config sets reactCompiler to false", () => {
    const projectDirectory = path.join(tempDirectory, "next-react-compiler-disabled");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "next-react-compiler-disabled",
        dependencies: { next: "^15.0.0", react: "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "next.config.ts"),
      "import type { NextConfig } from 'next';\nconst nextConfig: NextConfig = { reactCompiler: false };\nexport default nextConfig;\n",
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactCompiler).toBe(false);
  });

  it("detects React Compiler when next.config sets reactCompiler to true", () => {
    const projectDirectory = path.join(tempDirectory, "next-react-compiler-enabled");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "next-react-compiler-enabled",
        dependencies: { next: "^15.0.0", react: "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "next.config.ts"),
      "import type { NextConfig } from 'next';\nconst nextConfig: NextConfig = { reactCompiler: true };\nexport default nextConfig;\n",
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactCompiler).toBe(true);
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

  it("includes monorepo root when it has a React dependency", () => {
    const packages = listWorkspacePackages(
      path.join(FIXTURES_DIRECTORY, "monorepo-with-root-react"),
    );
    const packageNames = packages.map((workspacePackage) => workspacePackage.name);

    expect(packageNames).toContain("monorepo-root");
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

  it("handles nonexistent root directory without crashing", () => {
    const packages = discoverReactSubprojects("/nonexistent/path/that/doesnt/exist");
    expect(packages).toHaveLength(0);
  });

  it("skips subdirectory entries that are files instead of directories", () => {
    const rootDirectory = path.join(tempDirectory, "file-as-subdir");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );
    fs.writeFileSync(path.join(rootDirectory, "not-a-dir"), "just a file");

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("my-app");
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
