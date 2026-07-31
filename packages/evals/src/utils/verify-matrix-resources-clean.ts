import { setTimeout as delay } from "node:timers/promises";

import { DaytonaNotFoundError } from "@daytona/sdk";

import { MATRIX_CLEANUP_VERIFICATION_POLL_INTERVAL_MS } from "../constants.js";

export interface MatrixResourceClient {
  list: (options: { labels: { evaluation: string } }) => AsyncIterable<{ id: string }>;
  snapshot: {
    get: (snapshotName: string) => Promise<unknown>;
  };
}

export interface VerifyMatrixResourcesCleanInput {
  daytona: MatrixResourceClient;
  evaluationId: string;
  snapshotName: string;
  deadlineMilliseconds: number;
}

const inspectMatrixResources = async ({
  daytona,
  evaluationId,
  snapshotName,
}: Omit<VerifyMatrixResourcesCleanInput, "deadlineMilliseconds">): Promise<boolean> => {
  for await (const _sandbox of daytona.list({ labels: { evaluation: evaluationId } })) return false;
  try {
    await daytona.snapshot.get(snapshotName);
    return false;
  } catch (error) {
    if (error instanceof DaytonaNotFoundError) return true;
    throw error;
  }
};

const inspectMatrixResourcesBeforeDeadline = async (
  input: Omit<VerifyMatrixResourcesCleanInput, "deadlineMilliseconds">,
  remainingMilliseconds: number,
): Promise<boolean> => {
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    return await Promise.race([
      inspectMatrixResources(input),
      new Promise<boolean>((_resolve, reject) => {
        timeout = globalThis.setTimeout(
          () => reject(new Error("Timed out verifying exact matrix Daytona resource cleanup")),
          remainingMilliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout) globalThis.clearTimeout(timeout);
  }
};

export const verifyMatrixResourcesClean = async ({
  daytona,
  evaluationId,
  snapshotName,
  deadlineMilliseconds,
}: VerifyMatrixResourcesCleanInput): Promise<void> => {
  while (true) {
    const remainingMilliseconds = deadlineMilliseconds - globalThis.performance.now();
    if (remainingMilliseconds <= 0) {
      throw new Error("Timed out verifying exact matrix Daytona resource cleanup");
    }
    const isClean = await inspectMatrixResourcesBeforeDeadline(
      { daytona, evaluationId, snapshotName },
      remainingMilliseconds,
    );
    if (isClean) return;
    await delay(Math.min(MATRIX_CLEANUP_VERIFICATION_POLL_INTERVAL_MS, remainingMilliseconds));
  }
};
