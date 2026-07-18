import { parseArgs } from "node:util";

import {
  DEFAULT_CORPUS_CONCURRENCY,
  DEFAULT_REACT_DOCTOR_REF,
  DEFAULT_REACT_DOCTOR_REPOSITORY,
  DEFAULT_REPOSITORIES_SOURCES,
} from "./constants.js";

export interface EvaluationOptions {
  repositoriesSources: ReadonlyArray<string>;
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
        multiple: true,
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
      "Usage: nr eval -- [--repositories <path-url-or-directory>]... [--concurrency <count>] [--react-doctor-ref <git-ref>]",
    );
  }

  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }

  return {
    repositoriesSources: values.repositories ?? DEFAULT_REPOSITORIES_SOURCES,
    concurrency,
    reactDoctorRepository: values["react-doctor-repository"],
    reactDoctorRef: values["react-doctor-ref"],
  };
};
