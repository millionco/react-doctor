import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { discoverProject } from "../src/project-info/discover-project.js";
import { runOxlint } from "../src/run-oxlint.js";

let temporaryDirectory: string;
let projectDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "rd-untrusted-inputs-")),
  );
  projectDirectory = path.join(temporaryDirectory, "project");
  fs.mkdirSync(path.join(projectDirectory, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({ name: "fixture", dependencies: { react: "19.0.0" } }),
  );
  fs.writeFileSync(path.join(projectDirectory, "src/app.tsx"), 'eval("untrusted");\n');
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("untrusted lint inputs", () => {
  it("does not execute a plugin from an adopted config and still lints the source", async () => {
    const markerPath = path.join(temporaryDirectory, "executed-marker");
    fs.writeFileSync(
      path.join(projectDirectory, "payload.mjs"),
      `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(markerPath)}, "executed"); export default { meta: { name: "payload" }, rules: {} };`,
    );
    fs.writeFileSync(
      path.join(projectDirectory, ".oxlintrc.json"),
      '{"jsPlugins":["./payload.mjs"]}',
    );
    const diagnostics = await runOxlint({
      rootDirectory: projectDirectory,
      project: discoverProject(projectDirectory),
      includePaths: ["src/app.tsx"],
    });
    expect(fs.existsSync(markerPath)).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.rule === "no-eval")).toBe(true);
  });

  it("does not interpret option-shaped file paths as ignore flags", async () => {
    const decoyPath = "--ignore-pattern=src/app.tsx";
    fs.mkdirSync(path.dirname(path.join(projectDirectory, decoyPath)), { recursive: true });
    fs.writeFileSync(path.join(projectDirectory, decoyPath), "export const decoy = 1;\n");
    const diagnostics = await runOxlint({
      rootDirectory: projectDirectory,
      project: discoverProject(projectDirectory),
      includePaths: [decoyPath, "src/app.tsx"],
    });
    expect(diagnostics.some((diagnostic) => diagnostic.rule === "no-eval")).toBe(true);
  });

  it("preserves rules from a data-only adopted config", async () => {
    fs.writeFileSync(
      path.join(projectDirectory, ".oxlintrc.json"),
      '{"rules":{"no-debugger":"error"}}',
    );
    fs.writeFileSync(path.join(projectDirectory, "src/app.tsx"), "debugger;\n");
    const diagnostics = await runOxlint({
      rootDirectory: projectDirectory,
      project: discoverProject(projectDirectory),
      includePaths: ["src/app.tsx"],
    });
    expect(diagnostics.some((diagnostic) => diagnostic.rule === "no-debugger")).toBe(true);
  });
});
