import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildParityIndex, semanticHash } from "./build-parity-index.mjs";
import { compareParityIndexes, validateParityIndex } from "./compare-parity-indexes.mjs";

const selectedRuleKeys = new Set(["react-doctor/example", "react-doctor/other"]);
const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));

const buildRepository = (name) => ({
  org: "example",
  name,
  ref: "0123456789abcdef0123456789abcdef01234567",
  rootDir: ".",
});

const buildDiagnostic = (overrides = {}) => ({
  filePath: "src/app.tsx",
  normalizedFilePath: "src/app.tsx",
  id: "src/app.tsx::1:1::react-doctor/example::digest",
  line: 1,
  column: 1,
  plugin: "react-doctor",
  rule: "example",
  severity: "warning",
  title: "Example",
  message: "Example diagnostic",
  help: "Fix the example.",
  category: "Correctness",
  tags: [],
  ...overrides,
});

const buildRecord = ({
  name,
  diagnostics = [buildDiagnostic()],
  analyzedFiles = ["src/app.tsx"],
}) => {
  const directory = `/workspace/${name}`;
  const project = {
    directory,
    packageRoot: directory,
    framework: "nextjs",
    project: {},
    diagnostics,
    score: null,
    skippedChecks: [],
    analyzedFiles,
    analyzedFileCount: analyzedFiles.length,
    complete: true,
    elapsedMilliseconds: 1,
  };
  return {
    schemaVersion: 1,
    repository: buildRepository(name),
    report: {
      schemaVersion: 3,
      version: "0.9.2",
      ok: true,
      directory,
      mode: "full",
      diff: null,
      reactDetected: true,
      projects: [project],
      diagnostics,
      summary: {
        errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
        warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
        affectedFileCount: new Set(diagnostics.map((diagnostic) => diagnostic.filePath)).size,
        totalDiagnosticCount: diagnostics.length,
        score: null,
        scoreLabel: null,
      },
      elapsedMilliseconds: 1,
      error: null,
    },
  };
};

const buildIndex = async (records, rejectOutsideRuleScope = false, ruleKeys = selectedRuleKeys) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "react-doctor-parity-index-"));
  try {
    const inputPath = join(temporaryDirectory, "run.ndjson");
    writeFileSync(inputPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    return await buildParityIndex({
      inputPath,
      selectedRuleKeys: ruleKeys,
      rejectOutsideRuleScope,
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

test("runs parity index CLIs through relative script paths", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "react-doctor-parity-index-cli-"));
  try {
    const inputPath = join(temporaryDirectory, "run.ndjson");
    const ruleKeysPath = join(temporaryDirectory, "rules.json");
    const baselineIndexPath = join(temporaryDirectory, "baseline.index.json");
    const candidateIndexPath = join(temporaryDirectory, "candidate.index.json");
    writeFileSync(inputPath, `${JSON.stringify(buildRecord({ name: "first" }))}\n`);
    writeFileSync(ruleKeysPath, JSON.stringify([...selectedRuleKeys]));

    const buildResult = spawnSync(
      process.execPath,
      ["./build-parity-index.mjs", "--rules", ruleKeysPath, inputPath],
      { cwd: scriptDirectory, encoding: "utf8" },
    );
    assert.equal(buildResult.status, 0, buildResult.stderr);
    writeFileSync(baselineIndexPath, buildResult.stdout);
    writeFileSync(candidateIndexPath, buildResult.stdout);

    const compareResult = spawnSync(
      process.execPath,
      ["./compare-parity-indexes.mjs", baselineIndexPath, candidateIndexPath],
      { cwd: scriptDirectory, encoding: "utf8" },
    );
    assert.equal(compareResult.status, 0, compareResult.stderr);
    assert.equal(JSON.parse(compareResult.stdout).match, true);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("accepts canonical rule keys with camelCase rule segments", async () => {
  const diagnostic = buildDiagnostic({
    id: "src/app.tsx::1:1::react-doctor/prefer-useReducer::digest",
    rule: "prefer-useReducer",
  });
  const index = await buildIndex(
    [buildRecord({ name: "first", diagnostics: [diagnostic] })],
    false,
    new Set(["react-doctor/prefer-useReducer"]),
  );

  assert.equal(validateParityIndex(index), null);
});

test("writes explicit empty project-rule buckets", async () => {
  const index = await buildIndex([buildRecord({ name: "first" })]);
  const emptyBucket = index.projects[0].rules.find(
    (ruleBucket) => ruleBucket.rule === "react-doctor/other",
  );

  assert.deepEqual(emptyBucket, {
    rule: "react-doctor/other",
    diagnosticCount: 0,
    semanticHash: semanticHash([]),
  });
  assert.equal(validateParityIndex(index), null);
});

test("preserves duplicate diagnostic multiplicity", async () => {
  const diagnostic = buildDiagnostic();
  const baselineIndex = await buildIndex([
    buildRecord({ name: "first", diagnostics: [diagnostic] }),
  ]);
  const candidateIndex = await buildIndex([
    buildRecord({ name: "first", diagnostics: [diagnostic, diagnostic] }),
  ]);
  const comparison = compareParityIndexes(baselineIndex, candidateIndex);

  assert.equal(comparison.valid, true);
  assert.equal(comparison.match, false);
  assert.equal(comparison.summary.changedRules, 1);
  assert.equal(comparison.summary.changedProjectRuleBuckets, 1);
  assert.equal(comparison.changedRules[0].baselineDiagnostics, 1);
  assert.equal(comparison.changedRules[0].candidateDiagnostics, 2);
});

test("canonicalizes record and diagnostic order", async () => {
  const firstRecord = buildRecord({
    name: "first",
    diagnostics: [
      buildDiagnostic(),
      buildDiagnostic({
        id: "src/other.tsx::2:2::react-doctor/other::digest",
        filePath: "src/other.tsx",
        normalizedFilePath: "src/other.tsx",
        line: 2,
        column: 2,
        rule: "other",
      }),
    ],
    analyzedFiles: ["src/app.tsx", "src/other.tsx"],
  });
  const secondRecord = buildRecord({ name: "second" });
  const baselineIndex = await buildIndex([firstRecord, secondRecord]);
  const candidateIndex = await buildIndex([
    secondRecord,
    {
      ...firstRecord,
      report: {
        ...firstRecord.report,
        diagnostics: [...firstRecord.report.diagnostics].reverse(),
        projects: [
          {
            ...firstRecord.report.projects[0],
            diagnostics: [...firstRecord.report.projects[0].diagnostics].reverse(),
            analyzedFiles: [...firstRecord.report.projects[0].analyzedFiles].reverse(),
          },
        ],
      },
    },
  ]);
  const comparison = compareParityIndexes(baselineIndex, candidateIndex);

  assert.equal(comparison.valid, true);
  assert.equal(comparison.match, true);
  assert.equal(comparison.summary.ruleHashesChecked, 0);
  assert.equal(comparison.summary.projectRuleHashesChecked, 0);
  assert.equal(baselineIndex.wholeRunHash, candidateIndex.wholeRunHash);
  assert.notEqual(baselineIndex.sourceHash, candidateIndex.sourceHash);
});

test("descends only into changed rule and project hashes", async () => {
  const baselineIndex = await buildIndex([
    buildRecord({ name: "first" }),
    buildRecord({ name: "second" }),
  ]);
  const candidateIndex = await buildIndex([
    buildRecord({
      name: "first",
      diagnostics: [buildDiagnostic({ help: "Use the safe form." })],
    }),
    buildRecord({ name: "second" }),
  ]);
  const comparison = compareParityIndexes(baselineIndex, candidateIndex);

  assert.equal(comparison.valid, true);
  assert.equal(comparison.summary.comparedRules, baselineIndex.ruleBucketKeys.length);
  assert.equal(comparison.summary.ruleHashesChecked, baselineIndex.ruleBucketKeys.length);
  assert.equal(comparison.summary.projectRuleHashesChecked, 2);
  assert.equal(comparison.summary.changedRules, 1);
  assert.equal(comparison.summary.changedProjectRuleBuckets, 1);
  assert.equal(comparison.changedRules[0].rule, "react-doctor/example");
  assert.equal(comparison.changedRules[0].changedProjects[0].repository.name, "first");
});

test("fails closed when zero-hit coverage metadata differs", async () => {
  const baselineIndex = await buildIndex([buildRecord({ name: "first" })]);
  const candidateIndex = await buildIndex([
    buildRecord({
      name: "first",
      analyzedFiles: ["src/app.tsx", "src/zero-hit.tsx"],
    }),
  ]);
  const comparison = compareParityIndexes(baselineIndex, candidateIndex);

  assert.equal(comparison.valid, false);
  assert.match(comparison.metadataMismatches[0], /coverage differs/);
});

test("fails closed when project sets differ", async () => {
  const baselineIndex = await buildIndex([buildRecord({ name: "first" })]);
  const candidateIndex = await buildIndex([buildRecord({ name: "second" })]);
  const comparison = compareParityIndexes(baselineIndex, candidateIndex);

  assert.equal(comparison.valid, false);
  assert.deepEqual(comparison.metadataMismatches, ["Project sets differ"]);
});

test("candidate indexing rejects diagnostics outside the requested scope", async () => {
  await assert.rejects(
    buildIndex(
      [
        buildRecord({
          name: "first",
          diagnostics: [buildDiagnostic({ rule: "outside" })],
        }),
      ],
      true,
    ),
    /outside rule scope/,
  );
});

test("rejects legacy records because scoped coverage is unavailable", async () => {
  const record = buildRecord({ name: "first" });
  record.report.schemaVersion = 1;
  for (const project of record.report.projects) {
    delete project.packageRoot;
    delete project.framework;
    delete project.complete;
    delete project.analyzedFiles;
    delete project.analyzedFileCount;
  }

  await assert.rejects(buildIndex([record]), /scoped parity index requires v3 coverage/);
});

test("rejects tampered aggregate and whole-run hashes", async () => {
  const index = await buildIndex([buildRecord({ name: "first" })]);
  const tamperedAggregate = structuredClone(index);
  tamperedAggregate.rules[0].semanticHash = semanticHash("tampered");
  assert.match(validateParityIndex(tamperedAggregate), /aggregate is inconsistent/);

  const tamperedWholeRun = structuredClone(index);
  tamperedWholeRun.wholeRunHash = semanticHash("tampered");
  assert.match(validateParityIndex(tamperedWholeRun), /whole-run hash is inconsistent/);
});

test("rejects tampered repository metadata even when its key is recomputed", async () => {
  const index = await buildIndex([buildRecord({ name: "first" })]);
  const tamperedIndex = structuredClone(index);
  tamperedIndex.projects[0].repository.rootDir = "../outside";
  tamperedIndex.projects[0].key = JSON.stringify([
    tamperedIndex.projects[0].repository.org,
    tamperedIndex.projects[0].repository.name,
    tamperedIndex.projects[0].repository.ref,
    tamperedIndex.projects[0].repository.rootDir,
  ]);

  assert.match(validateParityIndex(tamperedIndex), /Invalid parity index project/);
});
