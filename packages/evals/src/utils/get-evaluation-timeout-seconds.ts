import { MILLISECONDS_PER_SECOND } from "../constants.js";

export interface GetEvaluationTimeoutSecondsInput {
  deadlineMilliseconds: number;
  maximumTimeoutSeconds: number;
  nowMilliseconds?: number;
}

export class EvaluationDeadlineExceededError extends Error {
  override readonly name = "EvaluationDeadlineExceededError";
}

export const getEvaluationTimeoutSeconds = ({
  deadlineMilliseconds,
  maximumTimeoutSeconds,
  nowMilliseconds = globalThis.performance.now(),
}: GetEvaluationTimeoutSecondsInput): number => {
  const remainingSeconds = Math.floor(
    (deadlineMilliseconds - nowMilliseconds) / MILLISECONDS_PER_SECOND,
  );
  if (remainingSeconds < 1)
    throw new EvaluationDeadlineExceededError("Evaluation time budget exhausted");
  return Math.min(maximumTimeoutSeconds, remainingSeconds);
};
