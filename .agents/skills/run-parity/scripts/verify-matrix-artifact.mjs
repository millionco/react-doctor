import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MATRIX_BASE_ARTIFACT_CONTRACT = "matrix-base-artifact-v1";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const hashFile = async (filePath) =>
  createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");

const assertFileBinding = async ({ artifactDirectory, binding, expectedPath, description }) => {
  if (
    binding === null ||
    typeof binding !== "object" ||
    binding.path !== expectedPath ||
    typeof binding.sha256 !== "string" ||
    !SHA256_PATTERN.test(binding.sha256) ||
    !Number.isSafeInteger(binding.byteLength) ||
    binding.byteLength <= 0
  ) {
    throw new Error(`${description} binding is invalid`);
  }
  const filePath = join(artifactDirectory, expectedPath);
  const [fileStats, sha256] = await Promise.all([stat(filePath), hashFile(filePath)]);
  if (fileStats.size !== binding.byteLength || sha256 !== binding.sha256) {
    throw new Error(`${description} bytes do not match provenance`);
  }
};

export const verifyMatrixArtifact = async (artifactDirectory) => {
  const resolvedDirectory = resolve(artifactDirectory);
  const provenance = JSON.parse(await readFile(join(resolvedDirectory, "provenance.json"), "utf8"));
  if (provenance.status !== "complete" || "baseArtifactPath" in provenance) {
    throw new Error("Matrix artifact is not complete canonical evidence");
  }
  const baseArtifact = provenance.baseArtifact;
  if (
    baseArtifact === null ||
    typeof baseArtifact !== "object" ||
    baseArtifact.contract !== MATRIX_BASE_ARTIFACT_CONTRACT ||
    baseArtifact.verified !== true ||
    "sourcePath" in baseArtifact ||
    "provenanceSourcePath" in baseArtifact ||
    typeof baseArtifact.producerSha256 !== "string" ||
    baseArtifact.producerSha256 !==
      createHash("sha256").update(JSON.stringify(baseArtifact.producer)).digest("hex")
  ) {
    throw new Error("Matrix base artifact binding is invalid");
  }
  await Promise.all([
    assertFileBinding({
      artifactDirectory: resolvedDirectory,
      binding: provenance.artifact,
      expectedPath: "candidate.ndjson",
      description: "Matrix candidate artifact",
    }),
    assertFileBinding({
      artifactDirectory: resolvedDirectory,
      binding: baseArtifact,
      expectedPath: "base.ndjson",
      description: "Matrix base artifact",
    }),
  ]);
  if (baseArtifact.provenancePath !== undefined) {
    if (
      baseArtifact.provenancePath !== "base-provenance.json" ||
      typeof baseArtifact.provenanceSha256 !== "string" ||
      !SHA256_PATTERN.test(baseArtifact.provenanceSha256) ||
      (await hashFile(join(resolvedDirectory, baseArtifact.provenancePath))) !==
        baseArtifact.provenanceSha256
    ) {
      throw new Error("Matrix base provenance bytes do not match provenance");
    }
  } else if (baseArtifact.provenanceSha256 !== undefined) {
    throw new Error("Matrix base provenance binding is incomplete");
  }
  return provenance;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const artifactDirectory = process.argv[2];
  if (!artifactDirectory || process.argv.length !== 3) {
    process.stderr.write("Usage: verify-matrix-artifact.mjs <artifact-directory>\n");
    process.exitCode = 2;
  } else {
    verifyMatrixArtifact(artifactDirectory).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
