export interface ResolveScoreUnavailableReasonInput {
  readonly isScoreDisabled: boolean;
  readonly isAnalysisIncomplete: boolean;
}

export const resolveScoreUnavailableReason = (
  input: ResolveScoreUnavailableReasonInput,
): "disabled" | "analysis-incomplete" | "api-unavailable" => {
  if (input.isScoreDisabled) return "disabled";
  return input.isAnalysisIncomplete ? "analysis-incomplete" : "api-unavailable";
};
