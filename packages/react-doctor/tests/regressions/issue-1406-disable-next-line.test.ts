/**
 * Regression test for GitHub issue #1406:
 * Verifies that `// react-doctor-disable-next-line` correctly suppresses
 * the `no-ref-current-in-render` diagnostic.
 */

import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import type { Diagnostic } from "@react-doctor/core";
import { createNodeReadFileLinesSync, mergeAndFilterDiagnostics } from "@react-doctor/core";
import { buildDiagnostic, writeFile } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-issue-1406-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const runFilter = (
  caseId: string,
  fileContents: string,
  diagnostics: Diagnostic[],
): Diagnostic[] => {
  const projectDir = path.join(tempRoot, caseId);
  writeFile(path.join(projectDir, "src", "repro.tsx"), fileContents);
  return mergeAndFilterDiagnostics(
    diagnostics,
    projectDir,
    null,
    createNodeReadFileLinesSync(projectDir),
    { warnings: true },
  );
};

describe("issue #1406: disable-next-line suppresses no-ref-current-in-render", () => {
  it("suppresses no-ref-current-in-render with react-doctor-disable-next-line", () => {
    const filtered = runFilter(
      "suppress-ref-mutation",
      `import { useRef } from "react"\n\n` +
        `export function Repro({ value }: { value: string }) {\n` +
        `  const valueRef = useRef(value)\n\n` +
        `  // react-doctor-disable-next-line react-doctor/no-ref-current-in-render -- minimal reproduction\n` +
        `  valueRef.current = value\n\n` +
        `  return <div>{value}</div>\n` +
        `}\n`,
      [
        buildDiagnostic({
          plugin: "react-doctor",
          rule: "no-ref-current-in-render",
          line: 7,
          filePath: "src/repro.tsx",
        }),
      ],
    );
    expect(filtered).toHaveLength(0);
  });

  it("fires no-ref-current-in-render without suppression comment", () => {
    const filtered = runFilter(
      "no-suppress-ref-mutation",
      `import { useRef } from "react"\n\n` +
        `export function Repro({ value }: { value: string }) {\n` +
        `  const valueRef = useRef(value)\n\n` +
        `  valueRef.current = value\n\n` +
        `  return <div>{value}</div>\n` +
        `}\n`,
      [
        buildDiagnostic({
          plugin: "react-doctor",
          rule: "no-ref-current-in-render",
          line: 6,
          filePath: "src/repro.tsx",
        }),
      ],
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rule).toBe("no-ref-current-in-render");
  });

  it("shows near-miss hint when suppression is one line away", () => {
    const filtered = runFilter(
      "gap-hint-ref-mutation",
      `import { useRef } from "react"\n\n` +
        `export function Repro({ value }: { value: string }) {\n` +
        `  const valueRef = useRef(value)\n` +
        `  // react-doctor-disable-next-line react-doctor/no-ref-current-in-render\n\n` +
        `  valueRef.current = value\n\n` +
        `  return <div>{value}</div>\n` +
        `}\n`,
      [
        buildDiagnostic({
          plugin: "react-doctor",
          rule: "no-ref-current-in-render",
          line: 7,
          filePath: "src/repro.tsx",
        }),
      ],
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].suppressionHint).toContain(
      "1 line of code separate it from the diagnostic",
    );
  });
});
