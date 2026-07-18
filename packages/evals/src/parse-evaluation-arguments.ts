import { parseArgs } from "node:util";

import {
  DEFAULT_CORPUS_CONCURRENCY,
  DEFAULT_REACT_DOCTOR_REF,
  DEFAULT_REACT_DOCTOR_REPOSITORY,
  DEFAULT_REPOSITORIES_SOURCE,
} from "./constants.js";

export interface EvaluationOptions {
  repositoriesSource: string;
  concurrency: number;
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
        default: DEFAULT_REPOSITORIES_SOURCE,
      },
      concurrency: {
        type: "string",
        default: String(DEFAULT_CORPUS_CONCURRENCY),
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
      "Usage: nr eval -- [--repositories <path-or-url>] [--concurrency <count>] [--react-doctor-ref <git-ref>]",
    );
  }

  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }

  return {
    repositoriesSource: values.repositories,
    concurrency,
    reactDoctorRepository: values["react-doctor-repository"],
    reactDoctorRef: values["react-doctor-ref"],
  };
};
