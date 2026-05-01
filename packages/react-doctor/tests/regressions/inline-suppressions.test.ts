/**
 * Regression tests for inline suppression support — closed issue #72.
 *
 * Three documented forms must all work:
 *   (a) `// react-doctor-disable-line <rule-id>` on the diagnostic's line
 *   (b) `// react-doctor-disable-next-line <rule-id>` on the line above
 *   (c) the bare comment with no rule id, which suppresses every
 *       diagnostic on the targeted line
 *
 * Multiple rule ids may be comma- or whitespace-separated, and the
 * suppression must NOT leak to neighboring lines.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import type { Diagnostic } from "../../src/types.js";
import { filterInlineSuppressions } from "../../src/utils/filter-diagnostics.js";
import { createNodeReadFileLinesSync } from "../../src/utils/read-file-lines-node.js";
import { buildDiagnostic, writeFile } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-inline-suppression-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

// HACK: each test allocates its own per-test directory so they can run
// in parallel without racing on the same `src/app.tsx` file.
// NOTE: filename case must match `buildDiagnostic`'s default `filePath:
// "src/app.tsx"` — Linux CI is case-sensitive and resolving a diagnostic
// with a mismatched case returns `null`, so no suppression is applied.
const runFilter = (
  caseId: string,
  fileContents: string,
  diagnostics: Diagnostic[],
): Diagnostic[] => {
  const projectDir = path.join(tempRoot, caseId);
  writeFile(path.join(projectDir, "src", "app.tsx"), fileContents);
  return filterInlineSuppressions(diagnostics, projectDir, createNodeReadFileLinesSync(projectDir));
};

const baseDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic =>
  buildDiagnostic({ rule: "no-derived-state-effect", ...overrides });

describe("issue #72: inline suppressions — variants", () => {
  it("disable-line suppresses a diagnostic on the SAME line", () => {
    const filtered = runFilter(
      "disable-line-same",
      `const x = 1; // react-doctor-disable-line react-doctor/no-derived-state-effect\n`,
      [baseDiagnostic({ line: 1 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("disable-next-line suppresses a diagnostic on the line BELOW", () => {
    const filtered = runFilter(
      "disable-next-line",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst x = 1;\n`,
      [baseDiagnostic({ line: 2 })],
    );
    expect(filtered).toHaveLength(0);
  });

  it("comma-separated rule list suppresses only the listed rules", () => {
    const filtered = runFilter(
      "comma-list",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect, react-doctor/no-fetch-in-effect\nconst x = 1;\n`,
      [
        baseDiagnostic({ rule: "no-derived-state-effect", line: 2 }),
        baseDiagnostic({ rule: "no-fetch-in-effect", line: 2 }),
        baseDiagnostic({ rule: "no-cascading-set-state", line: 2 }),
      ],
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rule).toBe("no-cascading-set-state");
  });

  it("whitespace-separated rule list also works", () => {
    const filtered = runFilter(
      "ws-list",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect react-doctor/no-fetch-in-effect\nconst x = 1;\n`,
      [
        baseDiagnostic({ rule: "no-derived-state-effect", line: 2 }),
        baseDiagnostic({ rule: "no-fetch-in-effect", line: 2 }),
      ],
    );
    expect(filtered).toHaveLength(0);
  });

  it("a bare disable comment (no rule id) suppresses EVERY diagnostic on that line", () => {
    const filtered = runFilter("bare-comment", `const x = 1; // react-doctor-disable-line\n`, [
      baseDiagnostic({ rule: "no-derived-state-effect", line: 1 }),
      baseDiagnostic({ rule: "no-fetch-in-effect", line: 1 }),
    ]);
    expect(filtered).toHaveLength(0);
  });
});

describe("issue #72: inline suppressions — boundary safety", () => {
  it("disable-line on line N does NOT suppress diagnostics on line N+1", () => {
    const filtered = runFilter(
      "boundary-line",
      `const x = 1; // react-doctor-disable-line react-doctor/no-derived-state-effect\nconst y = 2;\n`,
      [baseDiagnostic({ line: 2 })],
    );
    expect(filtered).toHaveLength(1);
  });

  it("disable-next-line on line N does NOT suppress diagnostics on line N+2", () => {
    const filtered = runFilter(
      "boundary-next-line",
      `// react-doctor-disable-next-line react-doctor/no-derived-state-effect\nconst x = 1;\nconst y = 2;\n`,
      [baseDiagnostic({ line: 3 })],
    );
    expect(filtered).toHaveLength(1);
  });

  it("does not suppress a different rule on the same line when a specific rule is listed", () => {
    const filtered = runFilter(
      "boundary-rule-mismatch",
      `const x = 1; // react-doctor-disable-line react-doctor/no-derived-state-effect\n`,
      [baseDiagnostic({ rule: "no-fetch-in-effect", line: 1 })],
    );
    expect(filtered).toHaveLength(1);
  });
});
