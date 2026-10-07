import {
  EVALUATION_CONFIG_CONTRACT,
  EVALUATION_RULE_KEY_PATTERN,
  PINNED_REPOSITORY_REF_PATTERN,
} from "../constants.js";
import type { ReactDoctorEvaluationProvenance } from "../corpus.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseReactDoctorEvaluationProvenance = (
  provenanceContents: string,
): ReactDoctorEvaluationProvenance => {
  const provenance: unknown = JSON.parse(provenanceContents);
  if (
    !isRecord(provenance) ||
    typeof provenance.reactDoctorRepository !== "string" ||
    typeof provenance.reactDoctorCommit !== "string" ||
    !PINNED_REPOSITORY_REF_PATTERN.test(provenance.reactDoctorCommit) ||
    provenance.configContract !== EVALUATION_CONFIG_CONTRACT ||
    typeof provenance.ruleSetHash !== "string" ||
    !SHA256_PATTERN.test(provenance.ruleSetHash) ||
    !Array.isArray(provenance.ruleKeys) ||
    !provenance.ruleKeys.every(
      (ruleKey) => typeof ruleKey === "string" && EVALUATION_RULE_KEY_PATTERN.test(ruleKey),
    )
  ) {
    throw new Error("Invalid React Doctor evaluation provenance");
  }
  return {
    reactDoctorRepository: provenance.reactDoctorRepository,
    reactDoctorCommit: provenance.reactDoctorCommit,
    configContract: provenance.configContract,
    ruleSetHash: provenance.ruleSetHash,
    ruleKeys: provenance.ruleKeys,
  };
};
