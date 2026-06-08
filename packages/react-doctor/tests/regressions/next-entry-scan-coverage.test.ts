import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-next-entry-scan-"));

const normalizeEntryDiagnosticPath = (filePath: string): string => {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (normalizedPath.endsWith("src/proxy.mjs")) return "src/proxy.mjs";
  if (normalizedPath.endsWith("middleware.ts")) return "middleware.ts";
  return normalizedPath;
};

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("Next middleware/proxy scan coverage", () => {
  it("emits diagnostics from middleware and proxy entry files", async () => {
    const projectDirectory = setupReactProject(tempRoot, "next-entry-files", {
      packageJsonExtras: {
        dependencies: {
          next: "^16.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      files: {
        ".oxlintrc.json": JSON.stringify({ rules: { "no-debugger": "error" } }),
        "middleware.ts": `export const middleware = () => {
  debugger;
  return undefined;
};
`,
        "src/proxy.mjs": `export const proxy = () => {
  debugger;
  return undefined;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDirectory,
      project: buildTestProject({ rootDirectory: projectDirectory, framework: "nextjs" }),
    });
    const debuggerFiles = diagnostics
      .filter((diagnostic) => diagnostic.rule === "no-debugger")
      .map((diagnostic) => normalizeEntryDiagnosticPath(diagnostic.filePath))
      .toSorted();

    expect(debuggerFiles).toEqual(["middleware.ts", "src/proxy.mjs"]);
  });
});
