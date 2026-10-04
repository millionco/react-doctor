import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importerPath = path.join(packageRoot, "scripts/import-react-bench-audit-corpus.mjs");
const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

describe("React Bench audit corpus importer", () => {
  it("keeps fixture mappings when callsites include reported columns", () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-fuzz-import-"));
    try {
      const source = "setTimeout(runLater, delay);\n";
      const suffix = "column-key";
      const relativeSourcePath = "src/example.tsx";
      const currentSourcesDirectory = path.join(temporaryRoot, "sources");
      const sourcePath = path.join(currentSourcesDirectory, suffix, relativeSourcePath);
      const contextsPath = path.join(temporaryRoot, "contexts.json");
      const corpusDirectory = path.join(temporaryRoot, "react-bench-0.9.7-audit");
      const manifestPath = path.join(temporaryRoot, "manifest.json");
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, source);
      fs.writeFileSync(
        contextsPath,
        JSON.stringify([
          {
            suffix,
            sourceTrialId: "00000000-0000-4000-8000-000000000000",
            auditVersion: "0.9.11",
            task: "example",
            patchSha256: sha256("patch"),
            rule: "effect-needs-cleanup",
            reconstructedFilePath: relativeSourcePath,
            reportedFilePath: relativeSourcePath,
            reportedLine: 1,
            reportedColumn: 1,
            sourceSha256: sha256(source),
            snippet: source,
            snippetSha256: sha256(source),
            snippetStartLine: 1,
            snippetEndLine: 1,
          },
        ]),
      );

      execFileSync(process.execPath, [
        importerPath,
        contextsPath,
        currentSourcesDirectory,
        corpusDirectory,
        manifestPath,
      ]);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.callsites[0].fixture).toBe(manifest.fixtures[0].fixture);
      expect(manifest.callsites[0].reportedColumn).toBe(1);
      expect(manifest.callsites[0].fixture).toMatch(/\.tsx\.txt$/);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
