import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { MATRIX_LOCAL_COMMAND_TIMEOUT_SECONDS, MILLISECONDS_PER_SECOND } from "./constants.js";
import type { LoadedMatrixTreatment } from "./matrix-treatment-descriptor.js";
import { getEvaluationTimeoutSeconds } from "./utils/get-evaluation-timeout-seconds.js";

const executeFile = promisify(execFile);

const fetchCommit = async ({
  repositoryDirectory,
  repository,
  commit,
  deadlineMilliseconds,
}: {
  repositoryDirectory: string;
  repository: string;
  commit: string;
  deadlineMilliseconds: number;
}): Promise<void> => {
  await executeFile(
    "git",
    ["-C", repositoryDirectory, "fetch", "--quiet", "--depth", "1", repository, commit],
    {
      timeout:
        getEvaluationTimeoutSeconds({
          deadlineMilliseconds,
          maximumTimeoutSeconds: MATRIX_LOCAL_COMMAND_TIMEOUT_SECONDS,
        }) * MILLISECONDS_PER_SECOND,
    },
  );
};

export const verifyMatrixImpactManifests = async (
  treatments: ReadonlyArray<LoadedMatrixTreatment>,
  deadlineMilliseconds: number,
): Promise<void> => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "react-doctor-matrix-impact-"));
  const repositoryDirectory = join(temporaryDirectory, "repository.git");
  const generatorPath = fileURLToPath(
    new URL("../../../.agents/skills/run-parity/scripts/find-impacted-rules.mjs", import.meta.url),
  );
  try {
    await executeFile("git", ["init", "--quiet", "--bare", repositoryDirectory], {
      timeout:
        getEvaluationTimeoutSeconds({
          deadlineMilliseconds,
          maximumTimeoutSeconds: MATRIX_LOCAL_COMMAND_TIMEOUT_SECONDS,
        }) * MILLISECONDS_PER_SECOND,
    });
    const fetchedCommits = new Set<string>();
    for (const treatment of treatments) {
      const references = [
        {
          repository: treatment.descriptor.group.baseReactDoctorRepository,
          commit: treatment.descriptor.group.baseReactDoctorCommit,
        },
        {
          repository: treatment.descriptor.reactDoctorRepository,
          commit: treatment.descriptor.reactDoctorCommit,
        },
      ];
      for (const reference of references) {
        const identity = JSON.stringify([reference.repository, reference.commit]);
        if (fetchedCommits.has(identity)) continue;
        await fetchCommit({ repositoryDirectory, deadlineMilliseconds, ...reference });
        fetchedCommits.add(identity);
      }
      const outputPath = join(temporaryDirectory, `${treatment.descriptor.id}.json`);
      await executeFile(
        process.execPath,
        [
          generatorPath,
          repositoryDirectory,
          treatment.descriptor.group.baseReactDoctorCommit,
          treatment.descriptor.reactDoctorCommit,
          outputPath,
        ],
        {
          timeout:
            getEvaluationTimeoutSeconds({
              deadlineMilliseconds,
              maximumTimeoutSeconds: MATRIX_LOCAL_COMMAND_TIMEOUT_SECONDS,
            }) * MILLISECONDS_PER_SECOND,
        },
      );
      const generatedContents = await readFile(outputPath, "utf8");
      if (generatedContents !== treatment.impactManifestContents) {
        throw new Error(
          `Impact manifest does not match the canonical generator: ${treatment.descriptor.id}`,
        );
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};
