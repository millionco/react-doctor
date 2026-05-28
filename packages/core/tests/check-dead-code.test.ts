import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { checkDeadCode } from "../src/check-dead-code.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-check-dead-code-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupProject = (caseId: string, files: Record<string, string>): string => {
  const projectDirectory = path.join(tempRoot, caseId);
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, "package.json"),
    JSON.stringify({
      name: caseId,
      type: "module",
      dependencies: { react: "^19.0.0" },
    }),
  );
  fs.writeFileSync(
    path.join(projectDirectory, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { jsx: "preserve", target: "es2022", module: "esnext" } }),
  );
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(projectDirectory, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }
  return projectDirectory;
};

describe("checkDeadCode", () => {
  it("returns no diagnostics when the directory has no package.json", async () => {
    const directory = path.join(tempRoot, "no-package-json");
    fs.mkdirSync(directory, { recursive: true });
    expect(await checkDeadCode({ rootDirectory: directory })).toEqual([]);
  });

  it("flags an orphan file with POSIX-separated paths under the Dead Code category", async () => {
    const directory = setupProject("unused-file", {
      "src/index.ts": "export const used = 1;\n",
      "src/orphan.ts": "export const orphan = 1;\n",
    });
    const diagnostics = await checkDeadCode({ rootDirectory: directory });
    const orphan = diagnostics.find(
      (diagnostic) =>
        diagnostic.rule === "unused-file" && diagnostic.filePath.endsWith("orphan.ts"),
    );
    expect(orphan).toBeDefined();
    expect(orphan?.plugin).toBe("deslop");
    expect(orphan?.category).toBe("Dead Code");
    expect(orphan?.filePath.includes("\\")).toBe(false);
  });

  it("honors ignore patterns from .gitignore and userConfig.ignore.files", async () => {
    const directory = setupProject("ignore-patterns", {
      "src/index.ts": "export const used = 1;\n",
      "src/gitignored.ts": "export const a = 1;\n",
      "src/configignored.ts": "export const b = 1;\n",
      ".gitignore": "src/gitignored.ts\n",
    });
    const diagnostics = await checkDeadCode({
      rootDirectory: directory,
      userConfig: { ignore: { files: ["src/configignored.ts"] } },
    });
    const flagged = diagnostics
      .filter((diagnostic) => diagnostic.rule === "unused-file")
      .map((diagnostic) => diagnostic.filePath);
    expect(flagged.some((entry) => entry.endsWith("gitignored.ts"))).toBe(false);
    expect(flagged.some((entry) => entry.endsWith("configignored.ts"))).toBe(false);
  });

  it("maps unused exports, dependencies, and cycles from worker results", async () => {
    const directory = setupProject("worker-result-shapes", {
      "src/index.ts": "export const used = 1;\n",
      "src/a.ts": "import './b';\n",
      "src/b.ts": "import './a';\n",
    });

    const diagnostics = await checkDeadCode({
      rootDirectory: directory,
      createWorker: () => ({
        result: Promise.resolve({
          unusedFiles: [],
          unusedExports: [
            {
              path: path.join(directory, "src", "index.ts"),
              name: "unused",
              line: 3,
              column: 14,
              isTypeOnly: false,
            },
            {
              path: path.join(directory, "src", "index.ts"),
              name: "UnusedType",
              line: 4,
              column: 12,
              isTypeOnly: true,
            },
          ],
          unusedDependencies: [
            {
              name: "left-pad",
              isDevDependency: false,
            },
            {
              name: "vitest",
              isDevDependency: true,
            },
          ],
          circularDependencies: [
            {
              files: [path.join(directory, "src", "a.ts"), path.join(directory, "src", "b.ts")],
            },
          ],
        }),
      }),
    });

    expect(diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "unused-export",
      "unused-type",
      "unused-dependency",
      "unused-dev-dependency",
      "circular-dependency",
    ]);
    expect(diagnostics.find((diagnostic) => diagnostic.rule === "unused-type")?.message).toContain(
      "Unused type export: `UnusedType`",
    );
    expect(
      diagnostics.find((diagnostic) => diagnostic.rule === "circular-dependency")?.message,
    ).toContain("src/a.ts → src/b.ts");
  });

  it("rejects malformed worker results instead of silently dropping diagnostics", async () => {
    const directory = setupProject("malformed-worker-result", {
      "src/index.ts": "export const used = 1;\n",
    });

    await expect(
      checkDeadCode({
        rootDirectory: directory,
        createWorker: () => ({
          result: Promise.resolve({
            unusedFiles: [{ path: 1 }],
            unusedExports: [],
            unusedDependencies: [],
            circularDependencies: [],
          }),
        }),
      }),
    ).rejects.toThrow("unusedFiles[0].path");
  });

  it("times out a stuck worker", async () => {
    const directory = setupProject("stuck-worker", {
      "src/index.ts": "export const used = 1;\n",
    });
    let didTerminate = false;

    await expect(
      checkDeadCode({
        rootDirectory: directory,
        createWorker: () => ({
          result: new Promise(() => {}),
          terminate: () => {
            didTerminate = true;
          },
        }),
        workerTimeoutMs: 1,
      }),
    ).rejects.toThrow("Dead-code worker timed out");
    expect(didTerminate).toBe(true);
  });
});
