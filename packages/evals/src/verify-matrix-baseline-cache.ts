import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  MATRIX_LOCAL_COMMAND_TIMEOUT_SECONDS,
  MILLISECONDS_PER_SECOND,
  SHA256_PATTERN,
} from "./constants.js";
import type { MatrixEvaluationGroup } from "./matrix-treatment-descriptor.js";
import { getEvaluationTimeoutSeconds } from "./utils/get-evaluation-timeout-seconds.js";
import type { MatrixBaseArtifactVerification } from "./utils/matrix-base-artifact-binding.js";

export interface MatrixBaselineArtifactVerification extends MatrixBaseArtifactVerification {
  provenanceSha256: string;
}

export interface MatrixBaselineCacheVerification {
  hit: boolean;
  invalid: boolean;
  reason?: string;
  artifact?: MatrixBaselineArtifactVerification;
}

const executeFile = promisify(execFile);

export const parseMatrixBaselineVerifierOutput = (
  output: string,
): MatrixBaselineArtifactVerification => {
  const verification: unknown = JSON.parse(output);
  if (
    typeof verification !== "object" ||
    verification === null ||
    !("provenance" in verification) ||
    typeof verification.provenance !== "object" ||
    verification.provenance === null ||
    !("artifact" in verification.provenance) ||
    typeof verification.provenance.artifact !== "object" ||
    verification.provenance.artifact === null ||
    !("sha256" in verification.provenance.artifact) ||
    typeof verification.provenance.artifact.sha256 !== "string" ||
    !SHA256_PATTERN.test(verification.provenance.artifact.sha256) ||
    !("byteLength" in verification.provenance.artifact) ||
    typeof verification.provenance.artifact.byteLength !== "number" ||
    !Number.isSafeInteger(verification.provenance.artifact.byteLength) ||
    verification.provenance.artifact.byteLength <= 0 ||
    !("provenanceSha256" in verification) ||
    typeof verification.provenanceSha256 !== "string" ||
    !SHA256_PATTERN.test(verification.provenanceSha256)
  ) {
    throw new Error("Baseline verifier returned an invalid artifact binding");
  }
  return {
    sha256: verification.provenance.artifact.sha256,
    byteLength: verification.provenance.artifact.byteLength,
    provenanceSha256: verification.provenanceSha256,
  };
};

export const verifyMatrixBaselineCache = async (
  group: MatrixEvaluationGroup,
  deadlineMilliseconds = globalThis.performance.now() +
    MATRIX_LOCAL_COMMAND_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND,
): Promise<MatrixBaselineCacheVerification> => {
  const existenceResults = await Promise.allSettled([
    access(group.baselineOutputPath),
    access(group.baselineProvenancePath),
  ]);
  const existingFileCount = existenceResults.filter(
    (result) => result.status === "fulfilled",
  ).length;
  if (existingFileCount === 0) {
    return { hit: false, invalid: false, reason: "baseline artifact or provenance is missing" };
  }
  if (existingFileCount !== existenceResults.length) {
    return {
      hit: false,
      invalid: true,
      reason: "baseline artifact and provenance must either both exist or both be absent",
    };
  }
  const verifierPath = fileURLToPath(
    new URL(
      "../../../.agents/skills/run-parity/scripts/baseline-cache-provenance.mjs",
      import.meta.url,
    ),
  );
  try {
    const { stdout } = await executeFile(
      process.execPath,
      [
        verifierPath,
        "verify",
        "--baseline",
        group.baselineOutputPath,
        "--provenance",
        group.baselineProvenancePath,
        "--corpus-manifest",
        group.corpusManifestPath,
        "--base-commit",
        group.baseReactDoctorCommit,
        "--repository",
        group.baseReactDoctorRepository,
        "--evaluator-source-hash",
        group.evaluatorSourceHash,
        "--config-contract",
        group.configContract,
        "--rule-set-hash",
        group.baseFullRuleSetHash,
      ],
      {
        timeout:
          getEvaluationTimeoutSeconds({
            deadlineMilliseconds,
            maximumTimeoutSeconds: MATRIX_LOCAL_COMMAND_TIMEOUT_SECONDS,
          }) * MILLISECONDS_PER_SECOND,
      },
    );
    const artifact = parseMatrixBaselineVerifierOutput(stdout);
    return {
      hit: true,
      invalid: false,
      artifact,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { hit: false, invalid: true, reason };
  }
};
