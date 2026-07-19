import { SandboxState } from "@daytona/sdk";
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
  await Promise.all(
    remainingSandboxes.map((sandbox) =>
      cleanupLimit(async () => {
        try {
          await daytona.delete(sandbox, SANDBOX_DELETE_TIMEOUT_SECONDS);
        } catch (error) {
          process.stderr.write(
            `Failed to clean up Daytona sandbox ${sandbox.id}: ${toErrorMessage(error)}\n`,
          );
        }
      }),
    ),
  );
};
