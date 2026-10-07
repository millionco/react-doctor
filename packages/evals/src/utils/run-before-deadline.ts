import { EvaluationDeadlineExceededError } from "./get-evaluation-timeout-seconds.js";

export interface RunBeforeDeadlineInput<Result> {
  operation: () => Promise<Result>;
  deadlineMilliseconds: number;
  timeoutMessage: string;
}

export const runBeforeDeadline = async <Result>({
  operation,
  deadlineMilliseconds,
  timeoutMessage,
}: RunBeforeDeadlineInput<Result>): Promise<Result> => {
  const remainingMilliseconds = deadlineMilliseconds - globalThis.performance.now();
  if (remainingMilliseconds <= 0) throw new EvaluationDeadlineExceededError(timeoutMessage);
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<Result>((_resolve, reject) => {
        timeout = globalThis.setTimeout(
          () => reject(new EvaluationDeadlineExceededError(timeoutMessage)),
          remainingMilliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
};
