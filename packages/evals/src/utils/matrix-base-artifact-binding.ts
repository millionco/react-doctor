import { createHash } from "node:crypto";
import { copyFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { MATRIX_BASE_ARTIFACT_CONTRACT } from "../constants.js";
import type { EvaluationProvenance } from "../corpus.js";
import { hashFileSha256 } from "./hash-file-sha256.js";

export interface MatrixBaseArtifactBinding {
  contract: string;
  sourcePath: string;
  sha256: string;
  byteLength: number;
  producer: EvaluationProvenance;
  producerSha256: string;
  provenanceSourcePath?: string;
  provenanceSha256?: string;
}

export interface MatrixBaseArtifactVerification {
  sha256: string;
  byteLength: number;
  provenanceSha256?: string;
}

export interface MaterializedMatrixBaseArtifactBinding {
  contract: string;
  path: string;
  sha256: string;
  byteLength: number;
  producer: EvaluationProvenance;
  producerSha256: string;
  provenancePath?: string;
  provenanceSha256?: string;
  verified: boolean;
}

const hashProducer = (producer: EvaluationProvenance): string =>
  createHash("sha256").update(JSON.stringify(producer)).digest("hex");

export const createMatrixBaseArtifactBinding = async ({
  sourcePath,
  producer,
  provenanceSourcePath,
  expected,
}: {
  sourcePath: string;
  producer: EvaluationProvenance;
  provenanceSourcePath?: string;
  expected?: MatrixBaseArtifactVerification;
}): Promise<MatrixBaseArtifactBinding> => {
  const [sourceStats, sha256, provenanceSha256] = await Promise.all([
    stat(sourcePath),
    hashFileSha256(sourcePath),
    provenanceSourcePath ? hashFileSha256(provenanceSourcePath) : undefined,
  ]);
  if (
    expected &&
    (sha256 !== expected.sha256 ||
      sourceStats.size !== expected.byteLength ||
      provenanceSha256 !== expected.provenanceSha256)
  ) {
    throw new Error("Matrix base artifact changed after verification");
  }
  return {
    contract: MATRIX_BASE_ARTIFACT_CONTRACT,
    sourcePath,
    sha256,
    byteLength: sourceStats.size,
    producer,
    producerSha256: hashProducer(producer),
    provenanceSourcePath,
    provenanceSha256,
  };
};

export const materializeMatrixBaseArtifactBinding = async ({
  binding,
  destinationDirectory,
}: {
  binding: MatrixBaseArtifactBinding;
  destinationDirectory: string;
}): Promise<MaterializedMatrixBaseArtifactBinding> => {
  const path = join(destinationDirectory, "base.ndjson");
  const provenancePath = binding.provenanceSourcePath
    ? join(destinationDirectory, "base-provenance.json")
    : undefined;
  try {
    await copyFile(binding.sourcePath, path);
    if (binding.provenanceSourcePath && provenancePath) {
      await copyFile(binding.provenanceSourcePath, provenancePath);
    }
    const [copiedStats, copiedSha256, copiedProvenanceSha256] = await Promise.all([
      stat(path),
      hashFileSha256(path),
      provenancePath ? hashFileSha256(provenancePath) : undefined,
    ]);
    const verified =
      copiedStats.size === binding.byteLength &&
      copiedSha256 === binding.sha256 &&
      copiedProvenanceSha256 === binding.provenanceSha256 &&
      hashProducer(binding.producer) === binding.producerSha256;
    if (!verified) {
      await Promise.all([
        rm(path, { force: true }),
        provenancePath ? rm(provenancePath, { force: true }) : undefined,
      ]);
    }
    return {
      contract: binding.contract,
      path: "base.ndjson",
      sha256: binding.sha256,
      byteLength: binding.byteLength,
      producer: binding.producer,
      producerSha256: binding.producerSha256,
      provenancePath: provenancePath ? "base-provenance.json" : undefined,
      provenanceSha256: binding.provenanceSha256,
      verified,
    };
  } catch {
    await Promise.all([
      rm(path, { force: true }),
      provenancePath ? rm(provenancePath, { force: true }) : undefined,
    ]);
    return {
      contract: binding.contract,
      path: "base.ndjson",
      sha256: binding.sha256,
      byteLength: binding.byteLength,
      producer: binding.producer,
      producerSha256: binding.producerSha256,
      provenancePath: provenancePath ? "base-provenance.json" : undefined,
      provenanceSha256: binding.provenanceSha256,
      verified: false,
    };
  }
};
