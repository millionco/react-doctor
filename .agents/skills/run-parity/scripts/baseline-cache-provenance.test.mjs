import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createBaselineCacheProvenance,
  verifyBaselineCacheProvenance,
} from "./baseline-cache-provenance.mjs";

const BASE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TARGET_COMMIT = "89abcdef0123456789abcdef0123456789abcdef";
const REACT_DOCTOR_REPOSITORY = "https://github.com/millionco/react-doctor.git";
const EVALUATOR_SOURCE_HASH = "a".repeat(64);
const CONFIG_CONTRACT = "all-rules-error-v1";
const RULE_SET_HASH = "b".repeat(64);

const buildRepository = (overrides = {}) => ({
  org: "example",
  name: "project",
  ref: TARGET_COMMIT,
  rootDir: ".",
  ...overrides,
});

const buildEvaluation = (overrides = {}) => ({
  reactDoctorRepository: REACT_DOCTOR_REPOSITORY,
  reactDoctorCommit: BASE_COMMIT,
  evaluatorSourceHash: EVALUATOR_SOURCE_HASH,
  configContract: CONFIG_CONTRACT,
  ruleSetHash: RULE_SET_HASH,
  ruleKeys: [],
  ...overrides,
});

const buildRecord = (overrides = {}) => ({
  schemaVersion: 1,
  repository: buildRepository(),
  evaluation: buildEvaluation(),
  report: { ok: true },
  ...overrides,
});

const withFixture = async (callback, records = [buildRecord()]) => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-cache-provenance-"));
  const baselinePath = join(directory, "baseline.ndjson");
  const corpusManifestPath = join(directory, "corpus-manifest.json");
  const provenancePath = join(directory, "baseline.provenance.json");
  await writeFile(baselinePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  await writeFile(
    corpusManifestPath,
    `${JSON.stringify(
      records.map((record) => record.repository),
      null,
      2,
    )}\n`,
  );
  const input = {
    baselinePath,
    corpusManifestPath,
    provenancePath,
    reactDoctorRepository: REACT_DOCTOR_REPOSITORY,
    reactDoctorCommit: BASE_COMMIT,
    evaluatorSourceHash: EVALUATOR_SOURCE_HASH,
    configContract: CONFIG_CONTRACT,
    ruleSetHash: RULE_SET_HASH,
  };
  try {
    await callback({ directory, input });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("creates adjacent schema v1 provenance and verifies it", async () => {
  await withFixture(async ({ input }) => {
    const created = await createBaselineCacheProvenance(input);
    const persisted = JSON.parse(await readFile(input.provenancePath, "utf8"));
    const verified = await verifyBaselineCacheProvenance(input);

    assert.equal(created.schemaVersion, 1);
    assert.equal(created.artifact.recordCount, 1);
    assert.equal(created.artifact.byteLength > 0, true);
    assert.match(created.artifact.sha256, /^[0-9a-f]{64}$/);
    assert.match(created.corpus.manifestSha256, /^[0-9a-f]{64}$/);
    assert.match(created.corpus.projectSetSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(persisted, created);
    assert.deepEqual(verified, created);
  });
});

test("rejects a corpus manifest with a different project tuple", async () => {
  await withFixture(async ({ input }) => {
    await writeFile(
      input.corpusManifestPath,
      `${JSON.stringify([buildRepository({ rootDir: "packages/app" })])}\n`,
    );

    await assert.rejects(
      createBaselineCacheProvenance(input),
      /project tuple set does not exactly match/,
    );
  });
});

test("rejects wrong expected commit, config contract, and evaluator source hash", async () => {
  await withFixture(async ({ input }) => {
    await createBaselineCacheProvenance(input);

    await assert.rejects(
      verifyBaselineCacheProvenance({
        ...input,
        reactDoctorCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
      /producer provenance does not match expected|Provenance producer does not match/,
    );
    await assert.rejects(
      verifyBaselineCacheProvenance({
        ...input,
        configContract: "different-config",
      }),
      /producer provenance does not match expected|Provenance producer does not match/,
    );
    await assert.rejects(
      verifyBaselineCacheProvenance({
        ...input,
        evaluatorSourceHash: "c".repeat(64),
      }),
      /producer provenance does not match expected|Provenance producer does not match/,
    );
  });
});

test("rejects raw-byte tampering after provenance creation", async () => {
  await withFixture(async ({ input }) => {
    await createBaselineCacheProvenance(input);
    const original = await readFile(input.baselinePath, "utf8");
    await writeFile(input.baselinePath, original.replace("\n", " \n"));

    await assert.rejects(
      verifyBaselineCacheProvenance(input),
      /Raw baseline artifact does not match/,
    );
  });
});

test("rejects mixed record producer provenance", async () => {
  const records = [
    buildRecord(),
    buildRecord({
      repository: buildRepository({ name: "second" }),
      evaluation: buildEvaluation({ ruleSetHash: "d".repeat(64) }),
    }),
  ];
  await withFixture(async ({ input }) => {
    await assert.rejects(
      createBaselineCacheProvenance(input),
      /record 2 producer provenance does not match expected/,
    );
  }, records);
});

test("rejects scoped records as a full baseline cache", async () => {
  const records = [
    buildRecord({
      evaluation: buildEvaluation({ ruleKeys: ["react-doctor/example"] }),
    }),
  ];
  await withFixture(async ({ input }) => {
    await assert.rejects(
      createBaselineCacheProvenance(input),
      /producer provenance does not match expected|not a full baseline/,
    );
  }, records);
});

test("rejects provenance and corpus tampering independently", async () => {
  await withFixture(async ({ input }) => {
    await createBaselineCacheProvenance(input);
    const provenance = JSON.parse(await readFile(input.provenancePath, "utf8"));
    provenance.corpus.projectSetSha256 = "f".repeat(64);
    await writeFile(input.provenancePath, `${JSON.stringify(provenance)}\n`);

    await assert.rejects(verifyBaselineCacheProvenance(input), /Corpus provenance does not match/);
  });
});
