import { parseArgs } from "node:util";
import { isAbsolute } from "node:path";

import {
  DEFAULT_CORPUS_CONCURRENCY,
  DEFAULT_CORPUS_REPOSITORY_COUNT,
  DEFAULT_EVALUATION_MAX_DURATION_MINUTES,
  DEFAULT_PAIRED_CORPUS_CONCURRENCY,
  DEFAULT_PROJECT_ROOTS_PER_REPOSITORY,
  DEFAULT_REACT_DOCTOR_REF,
  DEFAULT_REACT_DOCTOR_REPOSITORY,
  DEFAULT_REPOSITORIES_PER_SANDBOX,
  DEFAULT_REPOSITORIES_SOURCES,
  EVALUATION_CLEANUP_RESERVE_MINUTES,
  EVALUATION_RULE_KEY_PATTERN,
  EVALUATION_RETRY_ATTEMPT_RESERVE_MINUTES,
  EVALUATION_RETRY_CONCURRENCIES,
} from "./constants.js";

export interface PairedEvaluationOptions {
  baselineOutputPath: string;
  baseReactDoctorRepository: string;
  baseReactDoctorRef: string;
  baseRuleKeys: ReadonlyArray<string>;
  execution: "auto" | "parallel" | "sequential";
}

export interface EvaluationOptions {
  repositoriesSources: ReadonlyArray<string>;
  repositoryLimit: number;
  concurrency: number;
  repositoriesPerSandbox: number;
  projectRootsPerRepository: number;
  maxDurationMinutes: number;
  reactDoctorRepository: string;
  reactDoctorRef: string;
  ruleKeys: ReadonlyArray<string>;
  paired?: PairedEvaluationOptions;
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
      rule: {
        type: "string",
        multiple: true,
      },
      "paired-baseline-output": {
        type: "string",
      },
      "paired-base-react-doctor-repository": {
        type: "string",
      },
      "paired-base-react-doctor-ref": {
        type: "string",
      },
      "paired-base-rule": {
        type: "string",
        multiple: true,
      },
      "paired-execution": {
        type: "string",
      },
    },
  });

  if (positionals.length !== 0) {
    throw new Error(
      "Usage: nr eval -- [--repositories <path-url-or-directory>]... [--repository-limit <count>] [--project-roots-per-repository <count>] [--concurrency <count>] [--repositories-per-sandbox <count>] [--max-duration-minutes <count>] [--react-doctor-ref <git-ref>] [--rule <plugin/rule>]... [--paired-baseline-output <absolute-path> --paired-base-react-doctor-ref <git-ref>]",
    );
  }

  const pairedOptionValues = [
    values["paired-baseline-output"],
    values["paired-base-react-doctor-repository"],
    values["paired-base-react-doctor-ref"],
    values["paired-base-rule"],
    values["paired-execution"],
  ];
  const hasPairedOption = pairedOptionValues.some((value) => value !== undefined);
  const defaultConcurrency = hasPairedOption
    ? DEFAULT_PAIRED_CORPUS_CONCURRENCY
    : DEFAULT_CORPUS_CONCURRENCY;
  const concurrency = Number(values.concurrency ?? defaultConcurrency);
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

  const ruleKeys = [...new Set(values.rule ?? [])];
  const invalidRuleKey = ruleKeys.find((ruleKey) => !EVALUATION_RULE_KEY_PATTERN.test(ruleKey));
  if (invalidRuleKey !== undefined) {
    throw new Error(`--rule must be a canonical plugin/rule key: ${invalidRuleKey}`);
  }

  let paired: PairedEvaluationOptions | undefined;
  if (hasPairedOption) {
    const baselineOutputPath = values["paired-baseline-output"];
    const baseReactDoctorRef = values["paired-base-react-doctor-ref"];
    if (baselineOutputPath === undefined || baseReactDoctorRef === undefined) {
      throw new Error(
        "Paired evaluation requires --paired-baseline-output and --paired-base-react-doctor-ref",
      );
    }
    if (!isAbsolute(baselineOutputPath)) {
      throw new Error("--paired-baseline-output must be an absolute path");
    }
    const execution = values["paired-execution"] ?? "auto";
    if (execution !== "auto" && execution !== "parallel" && execution !== "sequential") {
      throw new Error("--paired-execution must be auto, parallel, or sequential");
    }
    const baseRuleKeys = [...new Set(values["paired-base-rule"] ?? [])];
    const invalidBaseRuleKey = baseRuleKeys.find(
      (ruleKey) => !EVALUATION_RULE_KEY_PATTERN.test(ruleKey),
    );
    if (invalidBaseRuleKey !== undefined) {
      throw new Error(
        `--paired-base-rule must be a canonical plugin/rule key: ${invalidBaseRuleKey}`,
      );
    }
    paired = {
      baselineOutputPath,
      baseReactDoctorRepository:
        values["paired-base-react-doctor-repository"] ?? values["react-doctor-repository"],
      baseReactDoctorRef,
      baseRuleKeys,
      execution,
    };
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
    ruleKeys,
    paired,
  };
};
