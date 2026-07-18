import { once } from "node:events";

import { Daytona } from "@daytona/sdk";
import pLimit from "p-limit";

import {
  MILLISECONDS_PER_SECOND,
  PERCENT_MULTIPLIER,
  PROGRESS_INTERVAL_PROJECTS,
  SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
  SANDBOX_CPU_CORES,
  SANDBOX_CREATE_TIMEOUT_SECONDS,
  SANDBOX_DELETE_TIMEOUT_SECONDS,
  SANDBOX_DISK_GIB,
  SANDBOX_IMAGE,
  SANDBOX_MEMORY_GIB,
  SANDBOX_SETUP_TIMEOUT_SECONDS,
  SETUP_REACT_DOCTOR_COMMAND,
  SUMMARY_DECIMAL_PLACES,
} from "./constants.js";
import type { CorpusEvaluationRecord } from "./corpus.js";
import { evaluateRepositoryGroup } from "./evaluate-repository-group.js";
import { executeSandboxCommand } from "./execute-sandbox-command.js";
import { groupCorpusRepositories } from "./group-corpus-repositories.js";
import { loadCorpusRepositories } from "./load-corpus-repositories.js";
import type { EvaluationOptions } from "./parse-evaluation-arguments.js";

export const runCorpusEvaluation = async (options: EvaluationOptions): Promise<void> => {
  const repositories = await loadCorpusRepositories(options.repositoriesSource);
  const repositoryGroups = groupCorpusRepositories(repositories);
  const startedAt = globalThis.performance.now();
  let completedProjects = 0;
  let failedProjects = 0;

  process.stderr.write(
    `Evaluating ${repositories.length} projects from ${repositoryGroups.length} repositories at concurrency ${options.concurrency}\n`,
  );

  const daytona = new Daytona();
  const seedSandbox = await daytona.create(
    {
      image: SANDBOX_IMAGE,
      ephemeral: true,
      autoStopInterval: SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
      labels: {
        project: "react-doctor",
        purpose: "eval-seed",
      },
      resources: {
        cpu: SANDBOX_CPU_CORES,
        memory: SANDBOX_MEMORY_GIB,
        disk: SANDBOX_DISK_GIB,
      },
    },
    { timeout: SANDBOX_CREATE_TIMEOUT_SECONDS },
  );

  try {
    process.stderr.write(`Building React Doctor in seed sandbox ${seedSandbox.id}\n`);
    await executeSandboxCommand({
      sandbox: seedSandbox,
      command: SETUP_REACT_DOCTOR_COMMAND,
      environment: {
        REACT_DOCTOR_REPOSITORY: options.reactDoctorRepository,
        REACT_DOCTOR_REF: options.reactDoctorRef,
      },
      timeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
      description: "Build React Doctor",
    });

    const recordEvaluation = async (record: CorpusEvaluationRecord): Promise<void> => {
      if (!process.stdout.write(`${JSON.stringify(record)}\n`)) {
        await once(process.stdout, "drain");
      }
      completedProjects += 1;
      if (record.error) failedProjects += 1;
      if (completedProjects % PROGRESS_INTERVAL_PROJECTS === 0) {
        process.stderr.write(`Completed ${completedProjects}/${repositories.length} projects\n`);
      }
    };

    const limit = pLimit(options.concurrency);
    await Promise.all(
      repositoryGroups.map((repositoryGroup) =>
        limit(() =>
          evaluateRepositoryGroup({
            daytona,
            seedSandbox,
            repositoryGroup,
            onRecord: recordEvaluation,
          }),
        ),
      ),
    );
  } finally {
    await daytona.delete(seedSandbox, SANDBOX_DELETE_TIMEOUT_SECONDS);
  }

  const completionRate = (completedProjects / repositories.length) * PERCENT_MULTIPLIER;
  const elapsedSeconds = (globalThis.performance.now() - startedAt) / MILLISECONDS_PER_SECOND;
  process.stderr.write(
    `Completion: ${completionRate.toFixed(SUMMARY_DECIMAL_PLACES)}% (${completedProjects}/${repositories.length}), failures: ${failedProjects}, elapsed: ${elapsedSeconds.toFixed(SUMMARY_DECIMAL_PLACES)}s\n`,
  );
};
