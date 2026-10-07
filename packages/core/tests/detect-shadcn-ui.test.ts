import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { detectShadcnUi } from "../src/project-info/detect-shadcn-ui.js";
import { discoverProject } from "../src/project-info/discover-project.js";
import { buildCapabilities } from "../src/project-info/capabilities.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-detect-shadcn-ui-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupProject = (caseId: string, files: Record<string, string>): string => {
  const projectDirectory = path.join(tempRoot, caseId);
  fs.mkdirSync(projectDirectory, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(projectDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  return projectDirectory;
};

describe("detectShadcnUi", () => {
  it("detects a components.json at the project root", () => {
    const projectDirectory = setupProject("config-at-root", {
      "components.json": JSON.stringify({ style: "new-york" }),
    });

    expect(detectShadcnUi(projectDirectory)).toBe(true);
  });

  it("returns false when no components.json exists up to the repository boundary", () => {
    const projectDirectory = setupProject("no-config/.git-holder", {});
    fs.mkdirSync(path.join(projectDirectory, ".git"), { recursive: true });

    expect(detectShadcnUi(projectDirectory)).toBe(false);
  });

  it("finds a workspace-root components.json from a nested package", () => {
    const workspaceRoot = setupProject("workspace", {
      "components.json": JSON.stringify({ style: "new-york" }),
      "apps/web/package.json": JSON.stringify({ name: "web" }),
    });
    fs.mkdirSync(path.join(workspaceRoot, ".git"), { recursive: true });

    expect(detectShadcnUi(path.join(workspaceRoot, "apps/web"))).toBe(true);
  });

  it("does not walk past a repository boundary", () => {
    const outerDirectory = setupProject("boundary", {
      "components.json": JSON.stringify({ style: "new-york" }),
    });
    const repositoryRoot = path.join(outerDirectory, "repo");
    fs.mkdirSync(path.join(repositoryRoot, ".git"), { recursive: true });

    expect(detectShadcnUi(repositoryRoot)).toBe(false);
  });

  it("drives the `shadcn` capability through discoverProject", () => {
    const projectDirectory = setupProject("capability", {
      "package.json": JSON.stringify({
        name: "shadcn-app",
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
      "components.json": JSON.stringify({ style: "new-york" }),
      "src/index.tsx": "export const noop = () => null;",
    });
    fs.mkdirSync(path.join(projectDirectory, ".git"), { recursive: true });

    const capabilities = buildCapabilities(discoverProject(projectDirectory));
    expect(capabilities.has("shadcn")).toBe(true);
  });

  it("finds a components.json inside a workspace during a root scan", () => {
    const projectDirectory = setupProject("workspace-capability", {
      "package.json": JSON.stringify({
        name: "workspace-root",
        private: true,
        workspaces: ["apps/*"],
      }),
      "apps/web/package.json": JSON.stringify({
        name: "web",
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
      "apps/web/components.json": JSON.stringify({ style: "new-york" }),
      "apps/web/src/index.tsx": "export const noop = () => null;",
    });
    fs.mkdirSync(path.join(projectDirectory, ".git"), { recursive: true });

    const capabilities = buildCapabilities(discoverProject(projectDirectory));
    expect(capabilities.has("shadcn")).toBe(true);
  });
});
