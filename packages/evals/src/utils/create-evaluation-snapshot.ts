import { Sandbox } from "@vercel/sandbox";
import type { Snapshot } from "@vercel/sandbox";

import {
  MILLISECONDS_PER_SECOND,
  SANDBOX_IMAGE,
  SANDBOX_SETUP_TIMEOUT_SECONDS,
  SANDBOX_DELETE_TIMEOUT_SECONDS,
  SANDBOX_SNAPSHOT_EXPIRATION_MS,
} from "../constants.js";
import { executeSandboxCommand } from "../execute-sandbox-command.js";
import { getEvaluationTimeoutSeconds } from "./get-evaluation-timeout-seconds.js";
import type { SandboxCredentials } from "./get-sandbox-credentials.js";

export interface EvaluationSnapshotBuild {
  environment: Record<string, string>;
  commands: ReadonlyArray<string>;
}

interface CreateEvaluationSnapshotInput {
  name: string;
  evaluationId: string;
  credentials: SandboxCredentials;
  build: EvaluationSnapshotBuild;
  resources: { cpu: number };
}

export const createEvaluationSnapshot = async (
  { name, evaluationId, credentials, build, resources }: CreateEvaluationSnapshotInput,
  deadlineMilliseconds: number,
): Promise<Snapshot> => {
  const timeoutSeconds = getEvaluationTimeoutSeconds({
    deadlineMilliseconds,
    maximumTimeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
  });
  const sandbox = await Sandbox.create({
    ...credentials,
    name,
    image: SANDBOX_IMAGE,
    persistent: false,
    resources: { vcpus: resources.cpu },
    timeout: timeoutSeconds * MILLISECONDS_PER_SECOND,
    tags: { evaluation: evaluationId },
    signal: AbortSignal.timeout(timeoutSeconds * MILLISECONDS_PER_SECOND),
  });
  try {
    await executeSandboxCommand({
      sandbox,
      command: [
        "set -eu",
        "sudo mkdir -p /workspace",
        "sudo chown $(id -u):$(id -g) /workspace",
        ...build.commands,
      ].join("\n"),
      environment: build.environment,
      timeoutSeconds: getEvaluationTimeoutSeconds({
        deadlineMilliseconds,
        maximumTimeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
      }),
      description: "Build React Doctor snapshot",
    });
    return await sandbox.snapshot({
      expiration: SANDBOX_SNAPSHOT_EXPIRATION_MS,
      signal: AbortSignal.timeout(
        getEvaluationTimeoutSeconds({
          deadlineMilliseconds,
          maximumTimeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
        }) * MILLISECONDS_PER_SECOND,
      ),
    });
  } finally {
    await sandbox.delete({
      signal: AbortSignal.timeout(SANDBOX_DELETE_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND),
    });
  }
};
