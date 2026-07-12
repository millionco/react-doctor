import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { createScanRunner } from "../../src/core/scan-runner.js";
import type { ScanOutcome, ScanRequest } from "../../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(here, "..", "fixtures", "simple-app");

describe("scan-runner", () => {
  it.each([
    {
      firstSource: 'export const App = () => <img src="x" />;\n',
      secondSource: 'export const App = () => <img alt="x" />;\n',
      firstHasAltText: true,
      secondHasAltText: false,
    },
    {
      firstSource: 'export const App = () => <img alt="x" />;\n',
      secondSource: 'export const App = () => <img src="x" />;\n',
      firstHasAltText: false,
      secondHasAltText: true,
    },
  ])(
    "does not replay equal-stat diagnostics after content changes %#",
    async ({ firstSource, secondSource, firstHasAltText, secondHasAltText }) => {
      expect(firstSource.length).toBe(secondSource.length);
      const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-scan-runner-cache-"));
      const sourceDirectory = path.join(projectDirectory, "src");
      const sourcePath = path.join(sourceDirectory, "App.tsx");
      fs.mkdirSync(path.join(projectDirectory, "node_modules"), { recursive: true });
      fs.mkdirSync(sourceDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(projectDirectory, "package.json"),
        JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      );
      fs.writeFileSync(sourcePath, firstSource);
      const originalStat = fs.statSync(sourcePath);
      const request: ScanRequest = {
        id: 1,
        priority: "save",
        projectDirectory,
        files: [sourcePath],
        runDeadCode: false,
        useOverlay: false,
        reason: "test",
      };
      const hasAltTextDiagnostic = (outcome: ScanOutcome | null) =>
        outcome !== null &&
        Array.from(outcome.byFile.values()).some((diagnostics) =>
          diagnostics.some((diagnostic) => diagnostic.rule.endsWith("alt-text")),
        );
      const firstRunner = createScanRunner({
        nodeBinaryPath: null,
        readText: () => null,
        version: "test",
      });
      let secondRunner: ReturnType<typeof createScanRunner> | null = null;

      try {
        const firstOutcome = await firstRunner.performScan(request, { isCancelled: false });
        expect(hasAltTextDiagnostic(firstOutcome)).toBe(firstHasAltText);
        firstRunner.dispose();

        fs.writeFileSync(sourcePath, secondSource);
        fs.utimesSync(sourcePath, originalStat.atime, originalStat.mtime);
        secondRunner = createScanRunner({
          nodeBinaryPath: null,
          readText: () => null,
          version: "test",
        });
        const secondOutcome = await secondRunner.performScan(
          { ...request, id: 2 },
          { isCancelled: false },
        );
        expect(hasAltTextDiagnostic(secondOutcome)).toBe(secondHasAltText);
      } finally {
        firstRunner.dispose();
        secondRunner?.dispose();
        fs.rmSync(projectDirectory, { recursive: true, force: true });
      }
    },
  );

  // Regression: a per-file request whose paths all resolve outside the
  // project must NOT fall through to a whole-project lint (an empty
  // include list is otherwise treated as "scan everything").
  it("does not whole-project scan when requested files are outside the project", async () => {
    const runner = createScanRunner({
      nodeBinaryPath: null,
      readText: () => null,
      version: "test",
      enableCache: false,
    });

    const request: ScanRequest = {
      id: 1,
      priority: "save",
      projectDirectory: FIXTURE_DIR,
      files: [path.join(here, "..", "..", "outside-the-project.tsx")],
      runDeadCode: false,
      useOverlay: false,
      reason: "test",
    };

    const outcome = await runner.performScan(request, { isCancelled: false });

    // Null = no result: no whole-project scan, and (crucially) no outcome
    // that would clear the unscanned file as if it were lint-clean.
    expect(outcome).toBeNull();
  });
});
