import {
  EVALUATION_MAXIMUM_RETRY_RESERVE_RATIO,
  EVALUATION_RETRY_ATTEMPT_RESERVE_MINUTES,
  MILLISECONDS_PER_MINUTE,
} from "../constants.js";

export interface GetEvaluationAttemptDeadlineMillisecondsInput {
  evaluationDeadlineMilliseconds: number;
  attemptIndex: number;
  totalAttempts: number;
  nowMilliseconds?: number;
}

export const getEvaluationAttemptDeadlineMilliseconds = ({
  evaluationDeadlineMilliseconds,
  attemptIndex,
  totalAttempts,
  nowMilliseconds = globalThis.performance.now(),
}: GetEvaluationAttemptDeadlineMillisecondsInput): number => {
  const remainingAttemptCount = Math.max(totalAttempts - attemptIndex - 1, 0);
  const requestedRetryReserveMilliseconds =
    remainingAttemptCount * EVALUATION_RETRY_ATTEMPT_RESERVE_MINUTES * MILLISECONDS_PER_MINUTE;
  const remainingEvaluationBudgetMilliseconds = Math.max(
    evaluationDeadlineMilliseconds - nowMilliseconds,
    0,
  );
  const maximumRetryReserveMilliseconds =
    remainingEvaluationBudgetMilliseconds * EVALUATION_MAXIMUM_RETRY_RESERVE_RATIO;
  return (
    evaluationDeadlineMilliseconds -
    Math.min(requestedRetryReserveMilliseconds, maximumRetryReserveMilliseconds)
  );
};
