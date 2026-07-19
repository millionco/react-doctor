import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const SUCCESS_EXIT_CODE = 0;
const scriptPath = fileURLToPath(new URL("./compare-parity.mjs", import.meta.url));

const repository = {
  org: "example",
  name: "project",
  ref: "0123456789abcdef",
  rootDir: ".",
};

const diagnostic = {
  id: "src/app.tsx::1:1::react-doctor/example::digest",
  normalizedFilePath: "src/app.tsx",
  filePath: "/baseline/src/app.tsx",
  line: 1,
  column: 1,
  plugin: "react-doctor",
  rule: "example",
  severity: "warning",
  message: "Example diagnostic",
};

test("compares diagnostics using stable report identities", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "react-doctor-parity-"));
  try {
    const baselinePath = join(temporaryDirectory, "baseline.ndjson");
    const candidatePath = join(temporaryDirectory, "candidate.ndjson");
    const baselineRecord = {
      schemaVersion: 1,
      repository,
      report: {
        diagnostics: [diagnostic, { ...diagnostic, id: undefined, rule: "legacy-example" }],
      },
    };
    const candidateRecord = {
      ...baselineRecord,
      report: {
        diagnostics: baselineRecord.report.diagnostics.map((reportDiagnostic) => ({
          ...reportDiagnostic,
          filePath: "C:\\candidate\\src\\app.tsx",
        })),
      },
    };
    writeFileSync(baselinePath, `${JSON.stringify(baselineRecord)}\n`);
    writeFileSync(candidatePath, `${JSON.stringify(candidateRecord)}\n`);

    const result = spawnSync(process.execPath, [scriptPath, baselinePath, candidatePath], {
      encoding: "utf8",
    });

    assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
    const comparison = JSON.parse(result.stdout);
    assert.equal(comparison.summary.added, 0);
    assert.equal(comparison.summary.removed, 0);
    assert.equal(comparison.summary.unchanged, 2);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
