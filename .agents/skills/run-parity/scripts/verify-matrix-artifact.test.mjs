import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyMatrixArtifact } from "./verify-matrix-artifact.mjs";

const hash = (contents) => createHash("sha256").update(contents).digest("hex");

const withArtifact = async (callback) => {
  const directory = await mkdtemp(join(tmpdir(), "verify-matrix-artifact-"));
  const artifactDirectory = join(directory, "artifact");
  await mkdir(artifactDirectory);
  const candidate = "candidate\n";
  const base = "base\n";
  const producer = { ruleKeys: ["react-doctor/example"] };
  await Promise.all([
    writeFile(join(artifactDirectory, "candidate.ndjson"), candidate),
    writeFile(join(artifactDirectory, "base.ndjson"), base),
  ]);
  const provenance = {
    status: "complete",
    artifact: {
      path: "candidate.ndjson",
      sha256: hash(candidate),
      byteLength: Buffer.byteLength(candidate),
    },
    baseArtifact: {
      contract: "matrix-base-artifact-v1",
      path: "base.ndjson",
      sha256: hash(base),
      byteLength: Buffer.byteLength(base),
      producer,
      producerSha256: hash(JSON.stringify(producer)),
      verified: true,
    },
  };
  await writeFile(join(artifactDirectory, "provenance.json"), JSON.stringify(provenance));
  try {
    await callback({ artifactDirectory, provenance });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("accepts bundled canonical matrix evidence", async () => {
  await withArtifact(async ({ artifactDirectory }) => {
    await assert.doesNotReject(verifyMatrixArtifact(artifactDirectory));
  });
});

test("rejects mutable source paths and changed bundled bytes", async () => {
  await withArtifact(async ({ artifactDirectory, provenance }) => {
    provenance.baseArtifact.sourcePath = "/mutable/base.ndjson";
    await writeFile(join(artifactDirectory, "provenance.json"), JSON.stringify(provenance));
    await assert.rejects(verifyMatrixArtifact(artifactDirectory), /binding is invalid/);
    delete provenance.baseArtifact.sourcePath;
    await writeFile(join(artifactDirectory, "provenance.json"), JSON.stringify(provenance));
    await writeFile(join(artifactDirectory, "base.ndjson"), "replacement\n");
    await assert.rejects(verifyMatrixArtifact(artifactDirectory), /bytes do not match provenance/);
  });
});
