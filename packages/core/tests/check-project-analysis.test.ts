import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { checkProjectAnalysis } from "@react-doctor/core";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProjectRoot = (): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-project-host-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), "{}");
  return fs.realpathSync(rootDirectory);
};

const workerResult = (rootDirectory: string) => ({
  analysisErrors: [],
  unusedFiles: [{ path: path.join(rootDirectory, "src/orphan.ts") }],
  unusedExports: [
    {
      path: path.join(rootDirectory, "src/library.ts"),
      name: "unusedValue",
      line: 4,
      column: 7,
      isTypeOnly: false,
    },
    {
      path: path.join(rootDirectory, "src/library.ts"),
      name: "UnusedShape",
      line: 8,
      column: 1,
      isTypeOnly: true,
    },
  ],
  unusedDependencies: [
    { name: "unused-package", isDevDependency: false },
    { name: "unused-dev-package", isDevDependency: true },
    { name: "react-doctor", isDevDependency: true },
  ],
  circularDependencies: [
    {
      files: [
        path.join(rootDirectory, "src/cycle-a.ts"),
        path.join(rootDirectory, "src/cycle-b.ts"),
      ],
    },
  ],
});

describe("checkProjectAnalysis", () => {
  it("maps every selected graph result to a canonical React Doctor diagnostic", async () => {
    const rootDirectory = createProjectRoot();
    const diagnostics = await checkProjectAnalysis({
      rootDirectory,
      enabledRuleIds: new Set([
        "unused-file",
        "unused-export",
        "unused-type",
        "unused-dependency",
        "unused-dev-dependency",
        "circular-dependency",
      ]),
      createWorker: () => ({ result: Promise.resolve(workerResult(rootDirectory)) }),
    });

    expect(diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "unused-file",
      "unused-export",
      "unused-type",
      "unused-dependency",
      "unused-dev-dependency",
      "circular-dependency",
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.plugin === "react-doctor")).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.category === "Maintainability")).toBe(true);
    expect(diagnostics[0]?.filePath).toBe("src/orphan.ts");
    expect(diagnostics.at(-1)?.message).toContain("src/cycle-a.ts → src/cycle-b.ts");
  });

  it("runs one worker and emits only explicitly enabled graph rules", async () => {
    const rootDirectory = createProjectRoot();
    const createWorker = vi.fn(() => ({ result: Promise.resolve(workerResult(rootDirectory)) }));
    const diagnostics = await checkProjectAnalysis({
      rootDirectory,
      enabledRuleIds: new Set(["unused-export", "unused-dev-dependency"]),
      excludedProjectDirectories: [path.join(rootDirectory, "packages/web")],
      ignorePatterns: ["src/generated/**"],
      createWorker,
    });

    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        ignorePatterns: ["src/generated/**", "packages/web/**"],
      }),
    );
    expect(diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "unused-export",
      "unused-dev-dependency",
    ]);
  });

  it("rejects malformed worker results", async () => {
    const rootDirectory = createProjectRoot();
    await expect(
      checkProjectAnalysis({
        rootDirectory,
        enabledRuleIds: new Set(["unused-file"]),
        createWorker: () => ({ result: Promise.resolve({ unusedFiles: null }) }),
      }),
    ).rejects.toThrow("invalid unusedFiles");
  });

  it("rejects incomplete worker results instead of reporting a clean project", async () => {
    const rootDirectory = createProjectRoot();
    await expect(
      checkProjectAnalysis({
        rootDirectory,
        enabledRuleIds: new Set(["unused-file"]),
        createWorker: () => ({
          result: Promise.resolve({
            ...workerResult(rootDirectory),
            analysisErrors: [
              {
                code: "resolver-init-failed",
                module: "resolver",
                severity: "fatal",
                message: "createResolver failed",
              },
            ],
          }),
        }),
      }),
    ).rejects.toThrow("Project analysis was incomplete");
  });

  it("preserves valid findings alongside recoverable analysis notes", async () => {
    const rootDirectory = createProjectRoot();
    const diagnostics = await checkProjectAnalysis({
      rootDirectory,
      enabledRuleIds: new Set(["unused-file"]),
      createWorker: () => ({
        result: Promise.resolve({
          ...workerResult(rootDirectory),
          analysisErrors: [
            {
              code: "file-empty",
              module: "parse",
              severity: "info",
              message: "File is empty",
            },
            {
              code: "parse-recovered",
              module: "parse",
              severity: "warning",
              message: "Parser recovered",
            },
          ],
        }),
      }),
    });

    expect(diagnostics.map((diagnostic) => diagnostic.rule)).toEqual(["unused-file"]);
  });

  it("terminates an in-flight worker when the scan is cancelled", async () => {
    const rootDirectory = createProjectRoot();
    const abortController = new AbortController();
    const terminate = vi.fn();
    const analysis = checkProjectAnalysis({
      rootDirectory,
      enabledRuleIds: new Set(["unused-file"]),
      abortSignal: abortController.signal,
      createWorker: () => ({ result: new Promise(() => {}), terminate }),
    });
    abortController.abort();

    await expect(analysis).rejects.toThrow("cancelled");
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates a worker that exceeds the mandatory timeout", async () => {
    const rootDirectory = createProjectRoot();
    const terminate = vi.fn();
    const analysis = checkProjectAnalysis({
      rootDirectory,
      enabledRuleIds: new Set(["unused-file"]),
      workerTimeoutMs: 1,
      createWorker: () => ({ result: new Promise(() => {}), terminate }),
    });

    await expect(analysis).rejects.toThrow("timed out");
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
