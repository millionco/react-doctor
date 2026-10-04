import { Sandbox } from "@vercel/sandbox";

import {
  EVALUATION_RUN_NAME,
  MILLISECONDS_PER_SECOND,
  PREPARE_SANDBOX_COMMAND,
  SANDBOX_CREATE_TIMEOUT_SECONDS,
  SANDBOX_SETUP_TIMEOUT_SECONDS,
} from "../constants.js";
import { executeSandboxCommand } from "../execute-sandbox-command.js";
import { getEvaluationTimeoutSeconds } from "./get-evaluation-timeout-seconds.js";
import type { SandboxCredentials } from "./get-sandbox-credentials.js";

interface CreateEvaluationSandboxInput {
  credentials: SandboxCredentials;
  name: string;
  evaluationId: string;
  snapshotId: string;
  cpuCores: number;
  deadlineMilliseconds: number;
}

export const createEvaluationSandbox = async ({
  credentials,
  name,
  evaluationId,
  snapshotId,
  cpuCores,
  deadlineMilliseconds,
}: CreateEvaluationSandboxInput): Promise<Sandbox> => {
  const sandbox = await Sandbox.create({
    ...credentials,
    name,
    source: { type: "snapshot", snapshotId },
    resources: { vcpus: cpuCores },
    persistent: false,
    timeout:
      getEvaluationTimeoutSeconds({
        deadlineMilliseconds,
        maximumTimeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
      }) * MILLISECONDS_PER_SECOND,
    tags: { evaluation: evaluationId, project: EVALUATION_RUN_NAME },
    signal: AbortSignal.timeout(
      getEvaluationTimeoutSeconds({
        deadlineMilliseconds,
        maximumTimeoutSeconds: SANDBOX_CREATE_TIMEOUT_SECONDS,
      }) * MILLISECONDS_PER_SECOND,
    ),
  });
  await executeSandboxCommand({
    sandbox,
    command: PREPARE_SANDBOX_COMMAND,
    environment: {},
    timeoutSeconds: getEvaluationTimeoutSeconds({
      deadlineMilliseconds,
      maximumTimeoutSeconds: SANDBOX_CREATE_TIMEOUT_SECONDS,
    }),
    description: "Prepare sandbox memory policy",
  });
  return sandbox;
};
