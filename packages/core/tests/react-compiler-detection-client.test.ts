import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { discoverProject } from "../src/project-info/discover-project.js";
import {
  takeReactCompilerDetection,
  warmReactCompilerDetection,
} from "../src/project-info/react-compiler-detection-client.js";

const workerScriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/react-compiler-detection-worker.js",
);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-compiler-detection-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const writeProject = (name: string, files: Record<string, string>): string => {
  const projectDirectory = path.join(temporaryRoot, name);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(projectDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return projectDirectory;
};

describe("react compiler detection worker", () => {
  it("answers what discovery computes for a project with and without the compiler", async () => {
    expect(fs.existsSync(workerScriptPath)).toBe(true);
    const withCompiler = writeProject("with-compiler", {
      "package.json": JSON.stringify({ name: "with", dependencies: { react: "19.0.0" } }),
      "babel.config.js": 'module.exports = { plugins: ["babel-plugin-react-compiler"] };\n',
      "src/App.tsx": "export const App = () => null;\n",
    });
    const withoutCompiler = writeProject("without-compiler", {
      "package.json": JSON.stringify({ name: "without", dependencies: { react: "19.0.0" } }),
      "vite.config.ts": 'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
      "src/App.tsx": "export const App = () => null;\n",
    });
    warmReactCompilerDetection(withCompiler, workerScriptPath);
    warmReactCompilerDetection(withoutCompiler, workerScriptPath);
    const [pendingWith, pendingWithout] = [
      takeReactCompilerDetection(withCompiler),
      takeReactCompilerDetection(withoutCompiler),
    ];
    expect(pendingWith).not.toBeNull();
    expect(takeReactCompilerDetection(withCompiler)).toBeNull();
    expect(await pendingWith).toBe(discoverProject(withCompiler).hasReactCompiler);
    expect(await pendingWith).toBe(true);
    expect(await pendingWithout).toBe(discoverProject(withoutCompiler).hasReactCompiler);
    expect(await pendingWithout).toBe(false);
  });

  it("leaves the decision to discovery when there is no package.json", async () => {
    const looseTree = writeProject("loose", { "src/App.tsx": "export const App = () => null;\n" });
    warmReactCompilerDetection(looseTree, workerScriptPath);
    expect(await takeReactCompilerDetection(looseTree)).toBeNull();
  });

  it("does nothing when the worker script is missing", () => {
    const projectDirectory = writeProject("missing-script", { "package.json": "{}" });
    warmReactCompilerDetection(projectDirectory, path.join(temporaryRoot, "missing-worker.js"));
    expect(takeReactCompilerDetection(projectDirectory)).toBeNull();
  });
});
