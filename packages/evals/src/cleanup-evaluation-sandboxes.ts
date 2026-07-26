import { DaytonaNotFoundError, SandboxState } from "@daytona/sdk";
import type { Daytona, Sandbox } from "@daytona/sdk";
import pLimit from "p-limit";

import { SANDBOX_CLEANUP_CONCURRENCY, SANDBOX_DELETE_TIMEOUT_SECONDS } from "./constants.js";
import { toErrorMessage } from "./utils/to-error-message.js";

export interface CleanupEvaluationSandboxesInput {
  daytona: Daytona;
  evaluationId: string;
}

export const cleanupEvaluationSandboxes = async ({
  daytona,
  evaluationId,
}: CleanupEvaluationSandboxesInput): Promise<void> => {
  const cleanupLimit = pLimit(SANDBOX_CLEANUP_CONCURRENCY);
  const remainingSandboxes: Sandbox[] = [];
  for await (const sandbox of daytona.list({ labels: { evaluation: evaluationId } })) {
    if (sandbox.state !== SandboxState.DESTROYING && sandbox.state !== SandboxState.DESTROYED) {
      remainingSandboxes.push(sandbox);
    }
  }
  const cleanupResults = await Promise.all(
    remainingSandboxes.map((sandbox) =>
      cleanupLimit(async () => {
        try {
          await daytona.delete(sandbox, SANDBOX_DELETE_TIMEOUT_SECONDS);
          return undefined;
        } catch (error) {
          try {
            const currentSandbox = await daytona.get(sandbox.id);
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
