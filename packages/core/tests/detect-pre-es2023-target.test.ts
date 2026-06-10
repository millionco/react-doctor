import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { detectPreES2023Target } from "../src/project-info/detect-pre-es2023-target.js";
import { discoverProject } from "../src/project-info/discover-project.js";
import { buildCapabilities } from "../src/runners/oxlint/capabilities.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-detect-es2023-target-"));

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

const writeTsConfig = (content: unknown): string => JSON.stringify(content, null, 2);

describe("detectPreES2023Target", () => {
  it("returns true for targets before ES2023", () => {
    const projectDirectory = setupProject("target-es2022", {
      "tsconfig.json": writeTsConfig({ compilerOptions: { target: "es2022" } }),
    });

    expect(detectPreES2023Target(projectDirectory)).toBe(true);
  });

  it("returns false for ES2023 targets", () => {
    const projectDirectory = setupProject("target-es2023", {
      "tsconfig.json": writeTsConfig({ compilerOptions: { target: "es2023" } }),
    });

    expect(detectPreES2023Target(projectDirectory)).toBe(false);
  });

  it("treats explicit libs without ES2023 array support as pre-ES2023", () => {
    const projectDirectory = setupProject("lib-es2022", {
      "tsconfig.json": writeTsConfig({ compilerOptions: { lib: ["es2022", "dom"] } }),
    });

    expect(detectPreES2023Target(projectDirectory)).toBe(true);
  });

  it("accepts the ES2023 array lib boundary", () => {
    const projectDirectory = setupProject("lib-es2023-array", {
      "tsconfig.json": writeTsConfig({
        compilerOptions: { lib: ["es2022", "es2023.array", "dom"] },
      }),
    });

    expect(detectPreES2023Target(projectDirectory)).toBe(false);
  });

  it("does not treat unrelated ES2023 component libs as array support", () => {
    const projectDirectory = setupProject("lib-es2023-collection", {
      "tsconfig.json": writeTsConfig({
        compilerOptions: { lib: ["es2022", "es2023.collection", "dom"] },
      }),
    });

    expect(detectPreES2023Target(projectDirectory)).toBe(true);
  });

  it("parses JSONC tsconfig files", () => {
    const projectDirectory = setupProject("jsonc-target", {
      "tsconfig.json": `{
        // Accepted by TypeScript's tsconfig parser.
        "compilerOptions": {
          "target": "es2022",
        },
      }`,
    });

    expect(detectPreES2023Target(projectDirectory)).toBe(true);
  });

  it("ignores sibling tsconfig.base.json when tsconfig.json does not extend it", () => {
    const projectDirectory = setupProject("same-directory-base", {
      "tsconfig.json": writeTsConfig({ compilerOptions: { module: "esnext" } }),
      "tsconfig.base.json": writeTsConfig({ compilerOptions: { target: "es2022" } }),
    });

    expect(detectPreES2023Target(projectDirectory)).toBe(false);
  });

  it("ignores standalone tsconfig.base.json because it is not the selected project config", () => {
    const projectDirectory = setupProject("base-only", {
      "tsconfig.base.json": writeTsConfig({ compilerOptions: { target: "es2022" } }),
    });

    expect(detectPreES2023Target(projectDirectory)).toBe(false);
  });

  it("inherits target through a relative extends chain", () => {
    const projectDirectory = setupProject("relative-extends", {
      "tsconfig.base.json": writeTsConfig({ compilerOptions: { target: "es2022" } }),
      "apps/web/tsconfig.json": writeTsConfig({ extends: "../../tsconfig.base.json" }),
    });

    expect(detectPreES2023Target(path.join(projectDirectory, "apps", "web"))).toBe(true);
  });

  it("lets child compiler options override inherited target", () => {
    const projectDirectory = setupProject("child-target-override", {
      "tsconfig.base.json": writeTsConfig({ compilerOptions: { target: "es2022" } }),
      "apps/web/tsconfig.json": writeTsConfig({
        extends: "../../tsconfig.base.json",
        compilerOptions: { target: "es2023" },
      }),
    });

    expect(detectPreES2023Target(path.join(projectDirectory, "apps", "web"))).toBe(false);
  });

  it("feeds the pre-ES2023 capability through project discovery", () => {
    const projectDirectory = setupProject("discovered-capability", {
      "package.json": writeTsConfig({
        name: "discovered-capability",
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        devDependencies: { vite: "^5.0.0" },
      }),
      "tsconfig.json": writeTsConfig({ compilerOptions: { target: "es2022" } }),
    });

    const projectInfo = discoverProject(projectDirectory);
    const capabilities = buildCapabilities(projectInfo);

    expect(projectInfo.isPreES2023Target).toBe(true);
    expect(capabilities.has("pre-es2023")).toBe(true);
  });
});
