import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Schema from "effect/Schema";
import { JsonReport } from "@react-doctor/core/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { commitAll, initGitRepo, writeFile, writeJson } from "./_helpers.js";

const CLI = path.resolve(import.meta.dirname, "../../bin/react-doctor.js");
const EFFECT = [
  'import { useEffect } from "react";',
  "export const App = ({ value, other }) => {",
  "  useEffect(() => {",
  "    document.title = value;",
  "  }, []);",
  "  return <div>{value}</div>;",
  "};",
  "",
].join("\n");
const ROWS = (count: number): string =>
  [
    "export const Rows = ({ rows }) => <ul>",
    ...Array.from(
      { length: count },
      () => "  {rows.map((row, index) => <li key={index}>{row}</li>)}",
    ),
    "</ul>;",
    "",
  ].join("\n");

const scan = (directory: string, flags: string[] = []) => {
  const result = spawnSync(
    process.execPath,
    [
      CLI,
      directory,
      "--json",
      "--no-score",
      "--no-dead-code",
      "--no-cache",
      "--yes",
      "--blocking",
      "warning",
      ...flags,
    ],
    {
      encoding: "utf-8",
      env: { ...process.env, CI: "true", REACT_DOCTOR_NO_UPDATE_NOTIFIER: "1" },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.stdout, result.stderr).not.toBe("");
  return {
    status: result.status,
    report: Schema.decodeUnknownSync(JsonReport)(JSON.parse(result.stdout)),
  };
};

interface ComparisonCase {
  name: string;
  baseSource: string;
  headSource?: string;
  rename?: boolean;
  untracked?: boolean;
  copy?: boolean;
  deleteFile?: boolean;
  expectedCount: number;
  expectedRule?: string;
  expectedLine?: number;
}

const CASES: ComparisonCase[] = [
  {
    name: "new tracked copy",
    baseSource: EFFECT,
    copy: true,
    expectedCount: 1,
    expectedRule: "exhaustive-deps",
    expectedLine: 5,
  },
  { name: "unchanged tree", baseSource: EFFECT, expectedCount: 0 },
  {
    name: "edit inside an existing effect",
    baseSource: EFFECT,
    headSource: EFFECT.replace("document.title = value;", 'document.title = "Title: " + value;'),
    expectedCount: 0,
  },
  {
    name: "edit on the flagged line",
    baseSource: EFFECT,
    headSource: EFFECT.replace("}, []);", "}, []); void 0;"),
    expectedCount: 0,
  },
  { name: "insert lines above", baseSource: EFFECT, headSource: "\n\n" + EFFECT, expectedCount: 0 },
  {
    name: "add a violation inside the flawed function",
    baseSource: EFFECT,
    headSource: EFFECT.replace(
      "  return",
      "  useEffect(() => { document.title = other; }, []);\n  return",
    ),
    expectedCount: 1,
    expectedRule: "exhaustive-deps",
    expectedLine: 6,
  },
  {
    name: "duplicate count grows from two to three",
    baseSource: ROWS(2),
    headSource: ROWS(3),
    expectedCount: 1,
    expectedRule: "no-array-index-as-key",
    expectedLine: 4,
  },
  {
    name: "two duplicates with one moved",
    baseSource: ROWS(2),
    headSource: ROWS(2).replace("\n  {", "\n\n\n  {"),
    expectedCount: 0,
  },
  { name: "rename unchanged content", baseSource: EFFECT, rename: true, expectedCount: 0 },
  {
    name: "new untracked file",
    baseSource: EFFECT,
    untracked: true,
    expectedCount: 1,
    expectedRule: "exhaustive-deps",
    expectedLine: 5,
  },
  {
    name: "remove an existing finding",
    baseSource: EFFECT,
    headSource: EFFECT.replace("}, []);", "}, [value]);"),
    expectedCount: 0,
  },
  { name: "delete a file", baseSource: EFFECT, deleteFile: true, expectedCount: 0 },
];

describe("changed scope compares findings through the CLI", () => {
  let directory: string;
  let reportFile: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-new-findings-"));
    reportFile = path.join(directory, "baseline.json");
    writeJson(path.join(directory, "package.json"), {
      name: "new-findings",
      dependencies: { react: "^19.0.0" },
    });
    writeJson(path.join(directory, "doctor.config.json"), {
      rules: { "react-doctor/no-array-index-as-key": "warn" },
    });
    writeFile(path.join(directory, "src/keep.tsx"), "export const Keep = () => <div />;\n");
    initGitRepo(directory);
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it.each(CASES)("$name", (testCase) => {
    const sourcePath = path.join(directory, "src/app.tsx");
    writeFile(sourcePath, testCase.baseSource);
    commitAll(directory, "base findings");
    writeFile(path.join(directory, "src/untouched.tsx"), EFFECT);
    commitAll(directory, "unrelated existing finding");
    const base = scan(directory);
    expect(base.report.diagnostics.length).toBeGreaterThan(0);
    writeJson(reportFile, base.report);
    if (testCase.headSource !== undefined) writeFile(sourcePath, testCase.headSource);
    if (testCase.rename)
      execFileSync("git", ["mv", "src/app.tsx", "src/renamed.tsx"], { cwd: directory });
    if (testCase.untracked || testCase.copy) writeFile(path.join(directory, "src/new.tsx"), EFFECT);
    if (testCase.copy) execFileSync("git", ["add", "src/new.tsx"], { cwd: directory });
    if (testCase.deleteFile) fs.rmSync(sourcePath);
    const flags = testCase.untracked ? ["--include-untracked"] : [];
    const gitResult = scan(directory, ["--scope", "changed", "--base", "HEAD", ...flags]);
    const savedResult = scan(directory, ["--scope", "changed", "--baseline", reportFile, ...flags]);
    for (const result of [gitResult, savedResult]) {
      expect(result.report.error).toBeNull();
      expect(result.report.diagnostics).toHaveLength(testCase.expectedCount);
      expect(result.report.summary.totalDiagnosticCount).toBe(testCase.expectedCount);
      expect(result.status).toBe(testCase.expectedCount === 0 ? 0 : 1);
      expect(result.report.schemaVersion).toBe(3);
      if (result.report.schemaVersion !== 3) throw new Error("Expected schema version 3");
      expect(result.report.baselineDegraded).not.toBe(true);
      expect(result.report.baseline?.matchedCount).toBeDefined();
      if (testCase.expectedRule)
        expect(result.report.diagnostics[0]?.rule).toBe(testCase.expectedRule);
      if (testCase.expectedLine)
        expect(result.report.diagnostics[0]?.line).toBe(testCase.expectedLine);
    }
    if (gitResult.report.schemaVersion === 3 && savedResult.report.schemaVersion === 3) {
      expect(gitResult.report.baseline?.source).toBe("base");
      expect(savedResult.report.baseline?.source).toBe("baseline");
      expect(savedResult.report.baseline?.baselineFile).toBe(reportFile);
      expect(savedResult.report.baseline?.matchedCount).toBe(
        gitResult.report.baseline?.matchedCount,
      );
      expect(savedResult.report.baseline?.fixedCount).toBe(gitResult.report.baseline?.fixedCount);
      expect(savedResult.report.baseline?.baseTotalCount).toBe(
        gitResult.report.baseline?.baseTotalCount,
      );
    }
  });

  it("uses a saved report without Git and rejects a report without fingerprints", () => {
    writeFile(path.join(directory, "src/app.tsx"), EFFECT);
    commitAll(directory, "base");
    const base = scan(directory);
    writeJson(reportFile, base.report);
    fs.rmSync(path.join(directory, ".git"), { recursive: true });
    writeFile(path.join(directory, "src/app.tsx"), "\n" + EFFECT);
    const result = scan(directory, ["--scope", "changed", "--baseline", reportFile]);
    expect(result.status).toBe(0);
    expect(result.report.diagnostics).toEqual([]);
    expect(scan(directory, ["--baseline", reportFile]).report.diagnostics).toEqual([]);
    const legacy = {
      ...base.report,
      diagnostics: base.report.diagnostics.map(
        ({ fingerprint: _fingerprint, ...diagnostic }) => diagnostic,
      ),
    };
    writeJson(reportFile, legacy);
    const invalid = scan(directory, ["--baseline", reportFile]);
    expect(invalid.status).not.toBe(0);
    expect(invalid.report.error?.message).toContain("fingerprints");
  });
});
