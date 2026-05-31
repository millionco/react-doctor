import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { diagnose } from "../src/index.js";
import { setupReactProject } from "./regressions/_helpers.js";

// Focused end-to-end coverage for the dead-code path: run the REAL
// deslop dead-code analysis through the public `diagnose()` API and
// assert the diagnostic actually surfaces. The other react-doctor
// pipeline tests pass `deadCode: false` because they assert on lint /
// project resolution, not dead-code, and running the deslop analysis in
// every one of them is pure overhead (the `api` package tests do the
// same). The dead-code worker itself runs as a child process now, so it
// tears down cleanly even on Windows — see core's check-dead-code.ts.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-dead-code-integration-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("diagnose() dead-code integration", () => {
  it("surfaces a real deslop unused-file diagnostic end-to-end", async () => {
    // Keep scoring offline — this test only exercises the dead-code path.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ score: 100, label: "Perfect" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const projectDir = setupReactProject(tempRoot, "unused-file", {
      packageJsonExtras: { type: "module" },
      files: {
        "src/index.ts": "export const used = 1;\n",
        "src/orphan.ts": "export const orphan = 1;\n",
      },
    });

    // lint:false keeps the fork to a single deslop worker spawn (no
    // oxlint). deadCode is on by default; set it explicitly for intent.
    const result = await diagnose(projectDir, { lint: false, deadCode: true, warnings: true });

    const orphan = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.rule === "unused-file" && diagnostic.filePath.endsWith("orphan.ts"),
    );
    expect(orphan).toBeDefined();
    expect(orphan?.plugin).toBe("deslop");
    expect(orphan?.category).toBe("Maintainability");
    // Proves the worker actually ran rather than being skipped or crashing.
    expect(result.skippedChecks).not.toContain("dead-code");
  });
});
