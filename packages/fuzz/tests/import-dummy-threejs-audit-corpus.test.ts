import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

interface ImportedDummyManifest {
  expected: {
    auditedProjects: number;
    totalCallsites: number;
    passCallsites: number;
    failCallsites: number;
    uniqueCallsiteFiles: number;
    uniqueFixtures: number;
  };
  fixtures: Array<{
    verdict: "pass" | "fail";
    fixtureSourceSha256: string;
  }>;
  callsites: Array<{
    reportedLine: number;
    verdict: "pass" | "fail";
  }>;
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importerPath = path.join(packageRoot, "scripts/import-dummy-threejs-audit-corpus.mjs");

describe("Dummy 3D audit corpus importer", () => {
  it("diffs logical callsites and preserves mixed verdicts from one exact source", () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dummy-fuzz-import-"));
    try {
      const sourceRoot = path.join(temporaryRoot, "tasks", "tml-001-example", "solution", "files");
      const sourcePath = path.join(sourceRoot, "src/example.ts");
      const beforeDiagnosticsPath = path.join(temporaryRoot, "before.tsv");
      const afterDiagnosticsPath = path.join(temporaryRoot, "after.tsv");
      const selectedRootsPath = path.join(temporaryRoot, "selected-roots.txt");
      const corpusDirectory = path.join(temporaryRoot, "dummy-threejs-v14-audit");
      const manifestPath = path.join(temporaryRoot, "manifest.json");
      const diagnosticRow = (line: number, rule: string, message: string): string =>
        [sourceRoot, "src/example.ts", line, 1, rule, message].join("\t");

      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(
        sourcePath,
        "const removed = true;\nconst added = true;\nconst stable = true;\n",
      );
      fs.writeFileSync(
        beforeDiagnosticsPath,
        `${diagnosticRow(1, "removed-rule", "removed message")}\n${diagnosticRow(3, "stable-rule", "old message")}\n`,
      );
      fs.writeFileSync(
        afterDiagnosticsPath,
        `${diagnosticRow(2, "added-rule", "added message")}\n${diagnosticRow(3, "stable-rule", "new message")}\n`,
      );
      fs.writeFileSync(selectedRootsPath, `${sourceRoot}\n`);

      execFileSync(process.execPath, [
        importerPath,
        beforeDiagnosticsPath,
        afterDiagnosticsPath,
        selectedRootsPath,
        corpusDirectory,
        manifestPath,
      ]);

      const manifest: ImportedDummyManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.expected).toEqual({
        auditedProjects: 1,
        totalCallsites: 2,
        passCallsites: 1,
        failCallsites: 1,
        uniqueCallsiteFiles: 1,
        uniqueFixtures: 2,
      });
      expect(manifest.callsites).toEqual([
        expect.objectContaining({ reportedLine: 1, verdict: "pass" }),
        expect.objectContaining({ reportedLine: 2, verdict: "fail" }),
      ]);
      expect(manifest.fixtures.map((fixture) => fixture.verdict).sort()).toEqual(["fail", "pass"]);
      expect(new Set(manifest.fixtures.map((fixture) => fixture.fixtureSourceSha256)).size).toBe(1);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
