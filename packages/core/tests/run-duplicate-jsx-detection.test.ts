import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { runDuplicateJsxDetection } from "../src/react-cleanup/run-duplicate-jsx-detection.js";
import type { SourceFileEntry } from "../src/types/index.js";

const workerScriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/duplicate-jsx-worker.js",
);
const missingWorkerScriptPath = path.join(os.tmpdir(), "react-doctor-missing-worker.js");

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const componentSource = (componentName: string, valueName: string): string => `
export const ${componentName} = () => (
  <${componentName}Screen>
    <Page>
      <section>
        <header><Title /></header>
        <main><Value value={${valueName}} /></main>
        <footer><Button /></footer>
      </section>
    </Page>
  </${componentName}Screen>
);
`;

interface TestProject {
  readonly rootDirectory: string;
  readonly sourceFiles: SourceFileEntry[];
}

const createProject = (): TestProject => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-duplicate-jsx-"));
  temporaryDirectories.push(rootDirectory);
  fs.mkdirSync(path.join(rootDirectory, "src"));
  const sourceFiles = [
    ["src/account.tsx", componentSource("Account", "account")],
    ["src/user.tsx", componentSource("User", "user")],
  ].map(([relativePath, sourceText]) => {
    fs.writeFileSync(path.join(rootDirectory, relativePath), sourceText);
    return { path: relativePath, sizeBytes: Buffer.byteLength(sourceText) };
  });
  return { rootDirectory, sourceFiles };
};

describe("runDuplicateJsxDetection", () => {
  it("produces the same families from the worker thread and the in-thread fallback", async () => {
    const project = createProject();
    const [workerResult, fallbackResult] = await Promise.all([
      runDuplicateJsxDetection({ ...project, workerScriptPath }),
      runDuplicateJsxDetection({ ...project, workerScriptPath: missingWorkerScriptPath }),
    ]);

    expect(fs.existsSync(workerScriptPath)).toBe(true);
    expect(workerResult.families).toHaveLength(1);
    expect(workerResult.families[0].primaryOccurrence.path).toBe("src/account.tsx");
    expect(workerResult).toEqual(fallbackResult);
  });

  it("serves consecutive projects from one shared worker", async () => {
    const results = await Promise.all(
      [createProject(), createProject()].map((project) =>
        runDuplicateJsxDetection({ ...project, workerScriptPath }),
      ),
    );

    expect(results.map((result) => result.families.length)).toEqual([1, 1]);
    expect(results[0].families[0].primaryOccurrence.path).toBe("src/account.tsx");
    expect(results[1].families[0].primaryOccurrence.path).toBe("src/account.tsx");
  });

  it("reports cancellation instead of failing when the signal is already aborted", async () => {
    const project = createProject();
    const abortController = new AbortController();
    abortController.abort();

    const result = await runDuplicateJsxDetection({
      ...project,
      workerScriptPath,
      signal: abortController.signal,
    });

    expect(result.incomplete).toBe(true);
    expect(result.incompleteReasons.map((reason) => reason.kind)).toContain("aborted");
  });

  it("rejects when the worker script cannot run", async () => {
    const project = createProject();
    const brokenWorkerScriptPath = path.join(project.rootDirectory, "broken-worker.js");
    fs.writeFileSync(brokenWorkerScriptPath, "process.exit(3);\n");

    await expect(
      runDuplicateJsxDetection({ ...project, workerScriptPath: brokenWorkerScriptPath }),
    ).rejects.toThrow("exited with code 3");
  });
});
