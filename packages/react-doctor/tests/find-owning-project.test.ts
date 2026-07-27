import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { findOwningProjectDirectory } from "../src/cli/utils/find-owning-project.js";
import { setupReactProject, writeJson } from "./regressions/_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-find-owning-project-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("findOwningProjectDirectory", () => {
  it("returns the root when no workspace packages exist", () => {
    const projectDir = setupReactProject(tempRoot, "single-project", {
      files: { "src/index.tsx": "export const A = () => null;" },
    });
    expect(findOwningProjectDirectory(projectDir, "src/index.tsx")).toBe(projectDir);
  });

  it("finds a nested React package under a standalone React root", () => {
    const projectRoot = setupReactProject(tempRoot, "standalone-with-nested");
    const nestedProjectDirectory = setupReactProject(
      path.join(projectRoot, "examples"),
      "playground",
    );

    expect(
      findOwningProjectDirectory(projectRoot, path.join(nestedProjectDirectory, "src", "App.tsx")),
    ).toBe(nestedProjectDirectory);
  });

  it("keeps package-less pnpm workspaces on fallback discovery", () => {
    const workspaceRoot = path.join(tempRoot, "package-less-pnpm");
    const projectDirectory = setupReactProject(path.join(workspaceRoot, "apps"), "web");
    fs.writeFileSync(path.join(workspaceRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");

    expect(
      findOwningProjectDirectory(workspaceRoot, path.join(projectDirectory, "src", "App.tsx")),
    ).toBe(projectDirectory);
  });

  it("keeps package-less Nx workspaces on fallback discovery", () => {
    const workspaceRoot = path.join(tempRoot, "package-less-nx");
    const projectDirectory = setupReactProject(path.join(workspaceRoot, "apps"), "web");
    writeJson(path.join(workspaceRoot, "nx.json"), {});

    expect(
      findOwningProjectDirectory(workspaceRoot, path.join(projectDirectory, "src", "App.tsx")),
    ).toBe(projectDirectory);
  });

  it("returns the workspace package whose directory contains the file", () => {
    const monorepoRoot = path.join(tempRoot, "monorepo");
    fs.mkdirSync(monorepoRoot, { recursive: true });
    writeJson(path.join(monorepoRoot, "package.json"), {
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    setupReactProject(monorepoRoot, "packages/web", {
      files: { "src/App.tsx": "export const App = () => null;" },
    });
    setupReactProject(monorepoRoot, "packages/api", {
      files: { "src/server.ts": "export const start = () => undefined;" },
    });

    const webFile = path.join(monorepoRoot, "packages/web/src/App.tsx");
    const apiFile = path.join(monorepoRoot, "packages/api/src/server.ts");

    expect(findOwningProjectDirectory(monorepoRoot, webFile)).toBe(
      path.join(monorepoRoot, "packages/web"),
    );
    expect(findOwningProjectDirectory(monorepoRoot, apiFile)).toBe(
      path.join(monorepoRoot, "packages/api"),
    );
  });

  it("falls back to the root when the file does not belong to any workspace package", () => {
    const monorepoRoot = path.join(tempRoot, "monorepo-fallback");
    fs.mkdirSync(monorepoRoot, { recursive: true });
    writeJson(path.join(monorepoRoot, "package.json"), {
      name: "monorepo-fallback",
      private: true,
      workspaces: ["packages/*"],
    });
    setupReactProject(monorepoRoot, "packages/web", {
      files: { "src/App.tsx": "export const App = () => null;" },
    });

    const orphanFile = path.join(monorepoRoot, "scripts/build.ts");
    expect(findOwningProjectDirectory(monorepoRoot, orphanFile)).toBe(monorepoRoot);
  });

  it("accepts relative file paths and resolves them against the root", () => {
    const monorepoRoot = path.join(tempRoot, "monorepo-relative");
    fs.mkdirSync(monorepoRoot, { recursive: true });
    writeJson(path.join(monorepoRoot, "package.json"), {
      name: "monorepo-relative",
      private: true,
      workspaces: ["packages/*"],
    });
    setupReactProject(monorepoRoot, "packages/web", {
      files: { "src/App.tsx": "export const App = () => null;" },
    });

    expect(findOwningProjectDirectory(monorepoRoot, "packages/web/src/App.tsx")).toBe(
      path.join(monorepoRoot, "packages/web"),
    );
  });

  it("returns the deepest nested React workspace that contains the file", () => {
    const monorepoRoot = path.join(tempRoot, "nested-monorepo");
    const shellDirectory = path.join(monorepoRoot, "packages", "shell");
    const featureDirectory = path.join(shellDirectory, "features", "billing");
    fs.mkdirSync(monorepoRoot, { recursive: true });
    writeJson(path.join(monorepoRoot, "package.json"), {
      name: "nested-monorepo",
      private: true,
      workspaces: ["packages/shell", "packages/shell/features/billing"],
    });
    setupReactProject(path.join(monorepoRoot, "packages"), "shell");
    setupReactProject(path.join(shellDirectory, "features"), "billing");

    expect(
      findOwningProjectDirectory(monorepoRoot, path.join(featureDirectory, "src", "invoice.tsx")),
    ).toBe(featureDirectory);
  });

  it("skips a nested non-React workspace when finding the owning React project", () => {
    const monorepoRoot = path.join(tempRoot, "nested-tool-monorepo");
    const webDirectory = path.join(monorepoRoot, "packages", "web");
    const generatorDirectory = path.join(webDirectory, "tools", "generator");
    fs.mkdirSync(monorepoRoot, { recursive: true });
    writeJson(path.join(monorepoRoot, "package.json"), {
      name: "nested-tool-monorepo",
      private: true,
      workspaces: ["packages/web", "packages/web/tools/generator"],
    });
    setupReactProject(path.join(monorepoRoot, "packages"), "web");
    writeJson(path.join(generatorDirectory, "package.json"), {
      name: "generator",
    });

    expect(
      findOwningProjectDirectory(monorepoRoot, path.join(generatorDirectory, "src", "index.ts")),
    ).toBe(webDirectory);
  });
});
