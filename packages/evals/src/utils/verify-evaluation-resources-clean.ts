import { setTimeout as delay } from "node:timers/promises";

import { Sandbox, Snapshot } from "@vercel/sandbox";
import type { SandboxCredentials } from "./get-sandbox-credentials.js";
import { isSandboxNotFoundError } from "./is-sandbox-not-found-error.js";

import { MATRIX_CLEANUP_VERIFICATION_POLL_INTERVAL_MS } from "../constants.js";
import { runBeforeDeadline } from "./run-before-deadline.js";

export interface VerifyEvaluationResourcesCleanInput {
  credentials: SandboxCredentials;
  evaluationId: string;
  snapshotId?: string;
  snapshotName: string;
  deadlineMilliseconds: number;
}

const inspectEvaluationResources = async ({
  credentials,
  evaluationId,
  snapshotId,
  snapshotName,
}: Omit<VerifyEvaluationResourcesCleanInput, "deadlineMilliseconds">): Promise<boolean> => {
  const sandboxes = await Sandbox.list({ ...credentials, tags: { evaluation: evaluationId } });
  for await (const _sandbox of sandboxes) return false;
  if (!snapshotId) {
    const snapshots = await Snapshot.list({ ...credentials, name: snapshotName });
    for await (const snapshot of snapshots) if (snapshot.status !== "deleted") return false;
    return true;
  }
  try {
    const snapshot = await Snapshot.get({ ...credentials, snapshotId });
    return snapshot.status === "deleted";
  } catch (error) {
    if (isSandboxNotFoundError(error)) return true;
    throw error;
  }
};

export const verifyEvaluationResourcesClean = async ({
  credentials,
  evaluationId,
  snapshotId,
  snapshotName,
  deadlineMilliseconds,
}: VerifyEvaluationResourcesCleanInput): Promise<void> => {
  while (true) {
    const remainingMilliseconds = deadlineMilliseconds - globalThis.performance.now();
    if (remainingMilliseconds <= 0) {
      throw new Error("Timed out verifying exact Vercel resource cleanup");
    }
    const isClean = await runBeforeDeadline({
      operation: () =>
        inspectEvaluationResources({ credentials, evaluationId, snapshotId, snapshotName }),
      deadlineMilliseconds,
      timeoutMessage: "Timed out verifying exact Vercel resource cleanup",
    });
    if (isClean) return;
    await delay(Math.min(MATRIX_CLEANUP_VERIFICATION_POLL_INTERVAL_MS, remainingMilliseconds));
  }
};
