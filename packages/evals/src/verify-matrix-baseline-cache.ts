import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { MatrixEvaluationGroup } from "./matrix-treatment-descriptor.js";

export interface MatrixBaselineCacheVerification {
  hit: boolean;
  invalid: boolean;
  reason?: string;
}

const executeFile = promisify(execFile);

export const verifyMatrixBaselineCache = async (
  group: MatrixEvaluationGroup,
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
    await executeFile(process.execPath, [
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
    ]);
    return { hit: true, invalid: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { hit: false, invalid: true, reason };
  }
};
