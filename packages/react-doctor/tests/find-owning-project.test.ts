import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { findOwningProjectDirectory } from "../src/utils/find-owning-project.js";
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
});
