import { Sandbox } from "@vercel/sandbox";

import {
  SANDBOX_CLEANUP_CONCURRENCY,
  SANDBOX_DELETE_TIMEOUT_SECONDS,
  MILLISECONDS_PER_SECOND,
} from "./constants.js";
import type { SandboxCredentials } from "./utils/get-sandbox-credentials.js";
import { isSandboxNotFoundError } from "./utils/is-sandbox-not-found-error.js";
import { runBeforeDeadline } from "./utils/run-before-deadline.js";
import { createConcurrencyLimit } from "./utils/create-concurrency-limit.js";

export interface CleanupEvaluationSandboxesInput {
  credentials: SandboxCredentials;
  evaluationId: string;
  deadlineMilliseconds: number;
}

export const cleanupEvaluationSandboxes = async ({
  credentials,
  evaluationId,
  deadlineMilliseconds,
}: CleanupEvaluationSandboxesInput): Promise<void> => {
  const cleanupLimit = createConcurrencyLimit(SANDBOX_CLEANUP_CONCURRENCY);
  const remainingSandboxes = await runBeforeDeadline({
    operation: async () => {
      const sandboxes = await Sandbox.list({ ...credentials, tags: { evaluation: evaluationId } });
      return sandboxes.toArray();
    },
    deadlineMilliseconds,
    timeoutMessage: "Timed out listing Vercel sandboxes for cleanup",
  });
  const results = await Promise.allSettled(
    remainingSandboxes.map((sandbox) =>
      cleanupLimit(async () => {
        try {
          await runBeforeDeadline({
            operation: async () => {
              const activeSandbox = await Sandbox.get({ ...credentials, name: sandbox.name });
              await activeSandbox.delete({
                signal: AbortSignal.timeout(
                  SANDBOX_DELETE_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND,
                ),
              });
            },
            deadlineMilliseconds,
            timeoutMessage: `Timed out deleting Vercel sandbox ${sandbox.name}`,
          });
        } catch (error) {
          if (!isSandboxNotFoundError(error)) throw error;
        }
      }),
    ),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length > 0)
    throw new AggregateError(errors, `Failed to clean up ${errors.length} Vercel sandboxes`);
};
