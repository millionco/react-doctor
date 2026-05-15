import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import type { Diagnostic } from "../src/types/diagnostic.js";
import { createNodeReadFileLinesSync } from "../src/core/read-file-lines-node.js";
import { mergeAndFilterDiagnostics } from "../src/core/merge-and-filter-diagnostics.js";
import { buildDiagnostic, writeFile } from "./regressions/_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-merge-and-filter-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupCase = (caseId: string, fileContents: string): string => {
  const projectDir = path.join(tempRoot, caseId);
  writeFile(path.join(projectDir, "src", "app.tsx"), fileContents);
  return projectDir;
};

const baseDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic =>
  buildDiagnostic({ rule: "no-derived-state-effect", line: 2, ...overrides });

describe("mergeAndFilterDiagnostics — respectInlineDisables option", () => {
  it("filters react-doctor-disable comments by default (respectInlineDisables defaults to true)", () => {
    const projectDir = setupCase(
      "default-respects-disables",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst x = 1;\n`,
    );
    const filtered = mergeAndFilterDiagnostics(
      [baseDiagnostic()],
      projectDir,
      null,
      createNodeReadFileLinesSync(projectDir),
    );
    expect(filtered).toHaveLength(0);
  });

  it("audit mode (respectInlineDisables=false) bypasses react-doctor-disable comments too", () => {
    const projectDir = setupCase(
      "audit-bypasses-disables",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst x = 1;\n`,
    );
    const filtered = mergeAndFilterDiagnostics(
      [baseDiagnostic()],
      projectDir,
      null,
      createNodeReadFileLinesSync(projectDir),
      { respectInlineDisables: false },
    );
    expect(filtered).toHaveLength(1);
  });

  it("audit mode still honors config-level ignore.rules and ignore.files", () => {
    const projectDir = setupCase("audit-honors-config-ignores", `const x = 1;\n`);
    const filtered = mergeAndFilterDiagnostics(
      [baseDiagnostic({ filePath: "src/skip.tsx", line: 1 })],
      projectDir,
      { ignore: { files: ["src/skip.tsx"] } },
      createNodeReadFileLinesSync(projectDir),
      { respectInlineDisables: false },
    );
    expect(filtered).toHaveLength(0);
  });
});
