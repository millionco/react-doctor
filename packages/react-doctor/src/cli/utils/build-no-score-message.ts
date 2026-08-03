import { ENTERPRISE_CONTACT_URL } from "@react-doctor/core";
import { resolveScoreUnavailableReason } from "./resolve-score-unavailable-reason.js";

const ENTERPRISE_CONTACT_HINT = `Want something custom to your company? Contact us at ${ENTERPRISE_CONTACT_URL}.`;

export interface BuildNoScoreMessageInput {
  readonly isScoreDisabled: boolean;
  readonly isAnalysisIncomplete?: boolean;
  readonly disabledMessage?: string;
}

export const buildNoScoreMessage = (input: BuildNoScoreMessageInput): string => {
  const unavailableReason = resolveScoreUnavailableReason({
    isScoreDisabled: input.isScoreDisabled,
    isAnalysisIncomplete: input.isAnalysisIncomplete ?? false,
  });
  let reason: string;
  switch (unavailableReason) {
    case "disabled":
      reason = input.disabledMessage ?? "Score disabled by --no-score.";
      break;
    case "analysis-incomplete":
      reason = "Score not shown because lint or dead-code analysis could not complete.";
      break;
    case "api-unavailable":
      reason = "Score unavailable (could not reach the score API).";
      break;
  }

  return `${reason} ${ENTERPRISE_CONTACT_HINT}`;
};
