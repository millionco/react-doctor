import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { createScanRunner } from "../../src/core/scan-runner.js";
import type { ScanRequest } from "../../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(here, "..", "fixtures", "simple-app");

describe("scan-runner", () => {
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
