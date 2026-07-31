import { DaytonaNotFoundError, SandboxState } from "@daytona/sdk";
import type { Daytona, Sandbox } from "@daytona/sdk";
import pLimit from "p-limit";

import { SANDBOX_CLEANUP_CONCURRENCY, SANDBOX_DELETE_TIMEOUT_SECONDS } from "./constants.js";
import { toErrorMessage } from "./utils/to-error-message.js";
import { runBeforeDeadline } from "./utils/run-before-deadline.js";

export interface CleanupEvaluationSandboxesInput {
  daytona: Daytona;
  evaluationId: string;
  deadlineMilliseconds: number;
}

export const cleanupEvaluationSandboxes = async ({
  daytona,
  evaluationId,
  deadlineMilliseconds,
}: CleanupEvaluationSandboxesInput): Promise<void> => {
  const cleanupLimit = pLimit(SANDBOX_CLEANUP_CONCURRENCY);
  const remainingSandboxes = await runBeforeDeadline({
    operation: async () => {
      const sandboxes: Sandbox[] = [];
      for await (const sandbox of daytona.list({ labels: { evaluation: evaluationId } })) {
        if (sandbox.state !== SandboxState.DESTROYING && sandbox.state !== SandboxState.DESTROYED) {
          sandboxes.push(sandbox);
        }
      }
      return sandboxes;
    },
    deadlineMilliseconds,
    timeoutMessage: "Timed out listing Daytona sandboxes for cleanup",
  });
  const cleanupResults = await Promise.all(
    remainingSandboxes.map((sandbox) =>
      cleanupLimit(async () => {
        try {
          await runBeforeDeadline({
            operation: () => daytona.delete(sandbox, SANDBOX_DELETE_TIMEOUT_SECONDS),
            deadlineMilliseconds,
            timeoutMessage: `Timed out deleting Daytona sandbox ${sandbox.id}`,
          });
          return undefined;
        } catch (error) {
          try {
            const currentSandbox = await runBeforeDeadline({
              operation: () => daytona.get(sandbox.id),
              deadlineMilliseconds,
              timeoutMessage: `Timed out recovering Daytona sandbox ${sandbox.id}`,
            });
            if (
              currentSandbox.state === SandboxState.DESTROYING ||
              currentSandbox.state === SandboxState.DESTROYED
            ) {
              return undefined;
            }
          } catch (recoveryError) {
            if (recoveryError instanceof DaytonaNotFoundError) return undefined;
            const cleanupError = new AggregateError(
              [error, recoveryError],
              `Failed to delete or recover Daytona sandbox ${sandbox.id}`,
            );
            process.stderr.write(`${toErrorMessage(cleanupError)}\n`);
            return cleanupError;
          }
          process.stderr.write(
            `Failed to clean up Daytona sandbox ${sandbox.id}: ${toErrorMessage(error)}\n`,
          );
          return error;
        }
      }),
    ),
  );
  const cleanupErrors = cleanupResults.filter((error) => error !== undefined);
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `Failed to clean up ${cleanupErrors.length} Daytona sandboxes`,
    );
  }
};
