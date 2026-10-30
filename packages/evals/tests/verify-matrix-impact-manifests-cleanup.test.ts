import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import {
  MATRIX_IMPACT_MANIFEST_OPERATION_TIMEOUT_MS,
  MATRIX_IMPACT_MANIFEST_TEST_TIMEOUT_MS,
  TEMPORARY_DIRECTORY_REMOVE_MAX_RETRIES,
} from "../src/constants.js";

interface CleanupFaultScenario {
  name: string;
  exhaustRetries: boolean;
  expiredDeadline: boolean;
}

const executeFile = promisify(execFile);
const fixturePath = fileURLToPath(
  new URL("./fixtures/matrix-impact-cleanup-fault.mjs", import.meta.url),
);
const targetUrl = new URL("../src/verify-matrix-impact-manifests.ts", import.meta.url).href;
const scenarios: CleanupFaultScenario[] = [
  { name: "retries a transient busy directory", exhaustRetries: false, expiredDeadline: false },
  {
    name: "propagates an exhausted busy-directory error",
    exhaustRetries: true,
    expiredDeadline: false,
  },
  {
    name: "preserves an earlier error after cleanup recovers",
    exhaustRetries: false,
    expiredDeadline: true,
  },
];

beforeAll(async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "matrix-cleanup-parent-prewarm-"));
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe(
  "verifyMatrixImpactManifests cleanup",
  { timeout: MATRIX_IMPACT_MANIFEST_TEST_TIMEOUT_MS },
  () => {
    it.each(scenarios)("$name", async ({ exhaustRetries, expiredDeadline }) => {
      const { stdout, stderr } = await executeFile(
        process.execPath,
        [fixturePath, targetUrl, JSON.stringify({ exhaustRetries, expiredDeadline })],
        {
          env: { ...process.env, NODE_OPTIONS: "" },
          timeout: MATRIX_IMPACT_MANIFEST_OPERATION_TIMEOUT_MS,
        },
      );
      expect(stderr).toBe("");
      const result = JSON.parse(stdout);
      expect(result.injectedBusyFailures).toBe(
        exhaustRetries ? TEMPORARY_DIRECTORY_REMOVE_MAX_RETRIES + 1 : 1,
      );
      expect(result.cleanupDirectoryObserved).toBe(true);
      expect(result.directoryRemainedAfterVerification).toBe(exhaustRetries);
      if (exhaustRetries) {
        expect(result.error).toEqual({
          name: "Error",
          code: "EBUSY",
          sameBusyError: true,
        });
      } else if (expiredDeadline) {
        expect(result.error).toEqual({
          name: "EvaluationDeadlineExceededError",
          sameBusyError: false,
        });
      } else {
        expect(result.error).toBeNull();
      }
    });
  },
);
