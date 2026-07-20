import { parseArgs } from "node:util";

import {
  DEFAULT_CORPUS_CONCURRENCY,
  DEFAULT_CORPUS_REPOSITORY_COUNT,
  DEFAULT_EVALUATION_MAX_DURATION_MINUTES,
  DEFAULT_PROJECT_ROOTS_PER_REPOSITORY,
  DEFAULT_REACT_DOCTOR_REF,
  DEFAULT_REACT_DOCTOR_REPOSITORY,
  DEFAULT_REPOSITORIES_PER_SANDBOX,
  DEFAULT_REPOSITORIES_SOURCES,
  EVALUATION_CLEANUP_RESERVE_MINUTES,
  EVALUATION_RETRY_ATTEMPT_RESERVE_MINUTES,
  EVALUATION_RETRY_CONCURRENCIES,
} from "./constants.js";

export interface EvaluationOptions {
  repositoriesSources: ReadonlyArray<string>;
  repositoryLimit: number;
  concurrency: number;
  repositoriesPerSandbox: number;
  projectRootsPerRepository: number;
  maxDurationMinutes: number;
  reactDoctorRepository: string;
  reactDoctorRef: string;
}

export const parseEvaluationArguments = (
  argumentsToParse: ReadonlyArray<string>,
): EvaluationOptions => {
  const { positionals, values } = parseArgs({
    args: argumentsToParse,
    strict: true,
    options: {
      repositories: {
        type: "string",
        multiple: true,
      },
      concurrency: {
        type: "string",
        default: String(DEFAULT_CORPUS_CONCURRENCY),
      },
      "repository-limit": {
        type: "string",
        default: String(DEFAULT_CORPUS_REPOSITORY_COUNT),
      },
      "repositories-per-sandbox": {
        type: "string",
        default: String(DEFAULT_REPOSITORIES_PER_SANDBOX),
      },
      "project-roots-per-repository": {
        type: "string",
        default: String(DEFAULT_PROJECT_ROOTS_PER_REPOSITORY),
      },
      "max-duration-minutes": {
        type: "string",
        default: String(DEFAULT_EVALUATION_MAX_DURATION_MINUTES),
      },
      "react-doctor-repository": {
        type: "string",
        default: DEFAULT_REACT_DOCTOR_REPOSITORY,
      },
      "react-doctor-ref": {
        type: "string",
        default: DEFAULT_REACT_DOCTOR_REF,
      },
    },
  });

  if (positionals.length !== 0) {
    throw new Error(
      "Usage: nr eval -- [--repositories <path-url-or-directory>]... [--repository-limit <count>] [--project-roots-per-repository <count>] [--concurrency <count>] [--repositories-per-sandbox <count>] [--max-duration-minutes <count>] [--react-doctor-ref <git-ref>]",
    );
  }

  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }

  const repositoryLimit = Number(values["repository-limit"]);
  if (!Number.isInteger(repositoryLimit) || repositoryLimit < 1) {
    throw new Error("--repository-limit must be a positive integer");
  }

  const repositoriesPerSandbox = Number(values["repositories-per-sandbox"]);
  if (!Number.isInteger(repositoriesPerSandbox) || repositoriesPerSandbox < 1) {
    throw new Error("--repositories-per-sandbox must be a positive integer");
  }

  const projectRootsPerRepository = Number(values["project-roots-per-repository"]);
  if (!Number.isInteger(projectRootsPerRepository) || projectRootsPerRepository < 1) {
    throw new Error("--project-roots-per-repository must be a positive integer");
  }

  const maxDurationMinutes = Number(values["max-duration-minutes"]);
  const reservedDurationMinutes =
    EVALUATION_CLEANUP_RESERVE_MINUTES +
    EVALUATION_RETRY_CONCURRENCIES.length * EVALUATION_RETRY_ATTEMPT_RESERVE_MINUTES;
  if (!Number.isFinite(maxDurationMinutes) || maxDurationMinutes <= reservedDurationMinutes) {
    throw new Error(
      `--max-duration-minutes must be greater than the ${reservedDurationMinutes}-minute cleanup and retry reserve`,
    );
  }

  return {
    repositoriesSources: values.repositories ?? DEFAULT_REPOSITORIES_SOURCES,
    repositoryLimit,
    concurrency,
    repositoriesPerSandbox,
    projectRootsPerRepository,
    maxDurationMinutes,
    reactDoctorRepository: values["react-doctor-repository"],
    reactDoctorRef: values["react-doctor-ref"],
  };
};
