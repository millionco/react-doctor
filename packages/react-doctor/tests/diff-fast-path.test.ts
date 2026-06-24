import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { diagnose } from "../src/index.js";
import { setupReactProject } from "./regressions/_helpers.js";

// The GitHub Action's PR fast path forwards `--scope changed
// --changed-files-from <file>`, which the CLI turns into a diff-mode scan
// (`includePaths` non-empty) that SKIPS dead-code + supply-chain — the two
// phases that dominate full scans. That skip is why PR runs are engine-fast
// (~1-3s) and install-bound (see plan 09). It's load-bearing for CI speed and
// easy to regress (e.g. a change that drops the `!isDiffMode` gate in
// run-inspect), so lock it behaviorally: the dead-code diagnostic a full scan
// surfaces must be ABSENT from a diff-mode scan of the same project.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-diff-fast-path-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubOfflineScore = () =>
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

const orphanFixture = (caseId: string): string =>
  setupReactProject(tempRoot, caseId, {
    packageJsonExtras: { type: "module" },
    files: {
      "src/index.ts": "export const used = 1;\n",
      "src/orphan.ts": "export const orphan = 1;\n",
    },
  });

describe("diff fast path (CI scope: changed)", () => {
  it("a full scan surfaces the orphan dead-code diagnostic (baseline)", async () => {
    stubOfflineScore();
    const projectDir = orphanFixture("full");
    const result = await diagnose(projectDir, { lint: false, deadCode: true, warnings: true });
    const orphan = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.rule === "unused-file" && diagnostic.filePath.endsWith("orphan.ts"),
    );
    expect(orphan).toBeDefined();
  });

  it("a diff-mode scan (changed files only) skips dead-code — no unused-file diagnostic", async () => {
    stubOfflineScore();
    const projectDir = orphanFixture("diff");
    // `includePaths` non-empty ⇒ diff mode. run-inspect gates BOTH dead-code
    // (`shouldRunDeadCode`) and supply-chain (`shouldRunSupplyChain`) on
    // `!isDiffMode`, so neither runs — the orphan unused-file the full scan
    // above found must not appear.
    const result = await diagnose(projectDir, {
      lint: false,
      deadCode: true,
      warnings: true,
      includePaths: ["src/index.ts"],
    });
    expect(result.diagnostics.some((diagnostic) => diagnostic.rule === "unused-file")).toBe(false);
  });
});
