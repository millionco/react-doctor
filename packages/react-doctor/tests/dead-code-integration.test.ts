import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { diagnose } from "../src/index.js";
import { setupReactProject } from "./regressions/_helpers.js";

// The single react-doctor test that runs the REAL deslop dead-code
// worker end-to-end through the public `diagnose()` API. It lives in
// its own file on purpose: vitest gives each test file its own fork, so
// the lone native `worker_threads` spawn runs in isolation — the same
// safe pattern core uses in tests/check-dead-code.test.ts. Every other
// react-doctor pipeline test passes `deadCode: false`, because routing
// the ~25 native worker spawns those tests would otherwise trigger
// through the heavy oxlint fork suite crashes Windows test workers
// ("Worker exited unexpectedly"); see packages/react-doctor/vite.config.ts.
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
    const result = await diagnose(projectDir, { lint: false, deadCode: true });

    const orphan = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.rule === "unused-file" && diagnostic.filePath.endsWith("orphan.ts"),
    );
    expect(orphan).toBeDefined();
    expect(orphan?.plugin).toBe("deslop");
    expect(orphan?.category).toBe("Dead Code");
    // Proves the worker actually ran rather than being skipped or crashing.
    expect(result.skippedChecks).not.toContain("dead-code");
  });
});
