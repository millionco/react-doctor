import { EVALUATION_RETRY_ATTEMPT_RESERVE_MINUTES, MILLISECONDS_PER_MINUTE } from "../constants.js";

export interface GetEvaluationAttemptDeadlineMillisecondsInput {
  evaluationDeadlineMilliseconds: number;
  attemptIndex: number;
  totalAttempts: number;
}

export const getEvaluationAttemptDeadlineMilliseconds = ({
  evaluationDeadlineMilliseconds,
  attemptIndex,
  totalAttempts,
}: GetEvaluationAttemptDeadlineMillisecondsInput): number => {
  const remainingAttemptCount = Math.max(totalAttempts - attemptIndex - 1, 0);
  return (
    evaluationDeadlineMilliseconds -
    remainingAttemptCount * EVALUATION_RETRY_ATTEMPT_RESERVE_MINUTES * MILLISECONDS_PER_MINUTE
  );
};
