import { randomUUID } from "node:crypto";

import { DaytonaNotFoundError } from "@daytona/sdk";
import type { Daytona, Sandbox } from "@daytona/sdk";

import {
  BASE_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
  BASE_REACT_DOCTOR_WORK_DIRECTORY,
  BASE_SANDBOX_REPORT_PATH,
  BASE_TARGET_WORK_DIRECTORY,
  DAYTONA_RUN_NAME,
  EVALUATION_SCHEMA_VERSION,
  REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
  REACT_DOCTOR_WORK_DIRECTORY,
  PAIRED_SANDBOX_SCAN_TIMEOUT_SECONDS,
  RESOLVE_PAIRED_TARGET_REPOSITORY_REF_COMMAND,
  RESOLVE_TARGET_REPOSITORY_REF_COMMAND,
  SANDBOX_DELETE_TIMEOUT_SECONDS,
  SANDBOX_REPORT_DOWNLOAD_TIMEOUT_SECONDS,
  SANDBOX_REPORT_PATH,
  SANDBOX_SCAN_TIMEOUT_SECONDS,
  SANDBOX_SETUP_TIMEOUT_SECONDS,
  SCAN_COMMAND,
  SETUP_PAIRED_TARGET_REPOSITORY_COMMAND,
  SETUP_TARGET_REPOSITORY_COMMAND,
  TARGET_WORK_DIRECTORY,
  TREATMENT_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
  TREATMENT_REACT_DOCTOR_WORK_DIRECTORY,
  TREATMENT_SANDBOX_REPORT_PATH,
  TREATMENT_TARGET_WORK_DIRECTORY,
} from "./constants.js";
import type {
  CorpusEvaluationRecord,
  CorpusRepository,
  CorpusRepositoryGroup,
  EvaluationProvenance,
} from "./corpus.js";
import { executeSandboxCommand } from "./execute-sandbox-command.js";
import {
  EvaluationDeadlineExceededError,
  getEvaluationTimeoutSeconds,
} from "./utils/get-evaluation-timeout-seconds.js";
import { parseReactDoctorReport } from "./utils/parse-react-doctor-report.js";
import { parseReactDoctorEvaluationProvenance } from "./utils/parse-react-doctor-evaluation-provenance.js";
import { toErrorMessage } from "./utils/to-error-message.js";
import { runBeforeDeadline } from "./utils/run-before-deadline.js";

export interface EvaluateRepositoryBatchInput {
  daytona: Daytona;
  createSandbox: (sandboxName: string, deadlineMilliseconds: number) => Promise<Sandbox>;
  repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>;
  evaluationDeadlineMilliseconds: number;
  evaluatorSourceHash: string;
  onRecord: (record: CorpusEvaluationRecord) => Promise<void>;
  paired?: PairedRepositoryBatchEvaluation;
}

export interface PairedRepositoryBatchEvaluation {
  runScansInParallel: boolean;
  onPairedRecords: (records: PairedEvaluationRecords) => Promise<void>;
}

export interface PairedEvaluationRecords {
  baseline: CorpusEvaluationRecord;
  treatment: CorpusEvaluationRecord;
}

interface EvaluateRepositoryGroupInput {
  sandbox: Sandbox;
  repositoryGroup: CorpusRepositoryGroup;
  evaluationProvenance: EvaluationProvenance;
  evaluationDeadlineMilliseconds: number;
  onRecord: (record: CorpusEvaluationRecord) => Promise<void>;
  paired?: PairedRepositoryGroupEvaluation;
}

interface PairedRepositoryGroupEvaluation {
  baselineEvaluationProvenance: EvaluationProvenance;
  runScansInParallel: boolean;
  onPairedRecords: (records: PairedEvaluationRecords) => Promise<void>;
}

export interface ScanRepositoryInput {
  sandbox: Sandbox;
  repository: CorpusRepository;
  reactDoctorWorkDirectory: string;
  reactDoctorRuleKeys: ReadonlyArray<string>;
  targetWorkDirectory: string;
  reportPath: string;
  evaluationDeadlineMilliseconds: number;
  descriptionPrefix: string;
  scanTimeoutSeconds: number;
}

export const buildRepositories = (
  repositoryGroup: CorpusRepositoryGroup,
): ReadonlyArray<CorpusRepository> =>
  repositoryGroup.rootDirectories.map((rootDirectory) => ({
    org: repositoryGroup.org,
    name: repositoryGroup.name,
    ref: repositoryGroup.ref,
    rootDir: rootDirectory,
  }));

export const buildFailureRecords = (
  repositories: ReadonlyArray<CorpusRepository>,
  error: unknown,
): ReadonlyArray<CorpusEvaluationRecord> => {
  const errorMessage = toErrorMessage(error);
  return repositories.map((repository) => ({
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    repository,
    error: errorMessage,
  }));
};

export const scanRepository = async ({
  sandbox,
  repository,
  reactDoctorWorkDirectory,
  reactDoctorRuleKeys,
  targetWorkDirectory,
  reportPath,
  evaluationDeadlineMilliseconds,
  descriptionPrefix,
  scanTimeoutSeconds,
}: ScanRepositoryInput): Promise<unknown> => {
  const commandResult = await executeSandboxCommand({
    sandbox,
    command: SCAN_COMMAND,
    environment: {
      REACT_DOCTOR_WORK_DIRECTORY: reactDoctorWorkDirectory,
      REACT_DOCTOR_RULE_KEYS: JSON.stringify(reactDoctorRuleKeys),
      TARGET_CHECKOUT_DIRECTORY: targetWorkDirectory,
      TARGET_ROOT_DIRECTORY: repository.rootDir,
      SANDBOX_REPORT_PATH: reportPath,
      // Keep eval scans out of production telemetry. `REACT_DOCTOR_NO_TELEMETRY`
      // is the one switch that covers every backend — blanking the Sentry DSN
      // alone no longer silences the Axiom exporter.
      REACT_DOCTOR_NO_TELEMETRY: "1",
      SENTRY_DSN: "",
      SENTRY_TRACES_SAMPLE_RATE: "0",
    },
    timeoutSeconds: getEvaluationTimeoutSeconds({
      deadlineMilliseconds: evaluationDeadlineMilliseconds,
      maximumTimeoutSeconds: scanTimeoutSeconds,
    }),
    description: `${descriptionPrefix} ${repository.org}/${repository.name}:${repository.rootDir}`,
    acceptNonZeroExitCode: true,
  });
  const reportContents = await sandbox.fs.downloadFile(
    reportPath,
    getEvaluationTimeoutSeconds({
      deadlineMilliseconds: evaluationDeadlineMilliseconds,
      maximumTimeoutSeconds: SANDBOX_REPORT_DOWNLOAD_TIMEOUT_SECONDS,
    }),
  );
  return parseReactDoctorReport(reportContents.toString("utf8"), commandResult.exitCode);
};

const evaluateRepositoryGroup = async ({
  sandbox,
  repositoryGroup,
  evaluationProvenance,
  evaluationDeadlineMilliseconds,
  onRecord,
  paired,
}: EvaluateRepositoryGroupInput): Promise<ReadonlyArray<CorpusEvaluationRecord>> => {
  let repositories = buildRepositories(repositoryGroup);
  try {
    const repositoryUrl = `https://github.com/${repositoryGroup.org}/${repositoryGroup.name}.git`;
    await executeSandboxCommand({
      sandbox,
      command: paired ? SETUP_PAIRED_TARGET_REPOSITORY_COMMAND : SETUP_TARGET_REPOSITORY_COMMAND,
      environment: {
        TARGET_REPOSITORY: repositoryUrl,
        TARGET_REF: repositoryGroup.ref,
      },
      timeoutSeconds: getEvaluationTimeoutSeconds({
        deadlineMilliseconds: evaluationDeadlineMilliseconds,
        maximumTimeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
      }),
      description: `Clone ${repositoryGroup.org}/${repositoryGroup.name}`,
    });
    const resolvedRef = (
      await executeSandboxCommand({
        sandbox,
        command: paired
          ? RESOLVE_PAIRED_TARGET_REPOSITORY_REF_COMMAND
          : RESOLVE_TARGET_REPOSITORY_REF_COMMAND,
        environment: {},
        timeoutSeconds: getEvaluationTimeoutSeconds({
          deadlineMilliseconds: evaluationDeadlineMilliseconds,
          maximumTimeoutSeconds: SANDBOX_SETUP_TIMEOUT_SECONDS,
        }),
        description: `Resolve ${repositoryGroup.org}/${repositoryGroup.name}`,
      })
    ).output.trim();
    repositories = repositories.map((repository) => ({ ...repository, ref: resolvedRef }));
  } catch (error) {
    return buildFailureRecords(repositories, error);
  }

  const failedRecords: CorpusEvaluationRecord[] = [];
  for (const repository of repositories) {
    if (paired) {
      let baselineReport: unknown;
      let treatmentReport: unknown;
      try {
        const scanBaseline = () =>
          scanRepository({
            sandbox,
            repository,
            reactDoctorWorkDirectory: BASE_REACT_DOCTOR_WORK_DIRECTORY,
            reactDoctorRuleKeys: paired.baselineEvaluationProvenance.ruleKeys,
            targetWorkDirectory: BASE_TARGET_WORK_DIRECTORY,
            reportPath: BASE_SANDBOX_REPORT_PATH,
            evaluationDeadlineMilliseconds,
            descriptionPrefix: "Scan base",
            scanTimeoutSeconds: PAIRED_SANDBOX_SCAN_TIMEOUT_SECONDS,
          });
        const scanTreatment = () =>
          scanRepository({
            sandbox,
            repository,
            reactDoctorWorkDirectory: TREATMENT_REACT_DOCTOR_WORK_DIRECTORY,
            reactDoctorRuleKeys: evaluationProvenance.ruleKeys,
            targetWorkDirectory: TREATMENT_TARGET_WORK_DIRECTORY,
            reportPath: TREATMENT_SANDBOX_REPORT_PATH,
            evaluationDeadlineMilliseconds,
            descriptionPrefix: "Scan treatment",
            scanTimeoutSeconds: PAIRED_SANDBOX_SCAN_TIMEOUT_SECONDS,
          });
        if (paired.runScansInParallel) {
          const [baselineResult, treatmentResult] = await Promise.allSettled([
            scanBaseline(),
            scanTreatment(),
          ]);
          if (baselineResult.status === "rejected") throw baselineResult.reason;
          if (treatmentResult.status === "rejected") throw treatmentResult.reason;
          baselineReport = baselineResult.value;
          treatmentReport = treatmentResult.value;
        } else {
          baselineReport = await scanBaseline();
          treatmentReport = await scanTreatment();
        }
      } catch (error) {
        failedRecords.push(...buildFailureRecords([repository], error));
        continue;
      }
      await paired.onPairedRecords({
        baseline: {
          schemaVersion: EVALUATION_SCHEMA_VERSION,
          repository,
          evaluation: paired.baselineEvaluationProvenance,
          report: baselineReport,
        },
        treatment: {
          schemaVersion: EVALUATION_SCHEMA_VERSION,
          repository,
          evaluation: evaluationProvenance,
          report: treatmentReport,
        },
      });
      continue;
    }

    try {
      const report = await scanRepository({
        sandbox,
        repository,
        reactDoctorWorkDirectory: REACT_DOCTOR_WORK_DIRECTORY,
        reactDoctorRuleKeys: evaluationProvenance.ruleKeys,
        targetWorkDirectory: TARGET_WORK_DIRECTORY,
        reportPath: SANDBOX_REPORT_PATH,
        evaluationDeadlineMilliseconds,
        descriptionPrefix: "Scan",
        scanTimeoutSeconds: SANDBOX_SCAN_TIMEOUT_SECONDS,
      });
      await onRecord({
        schemaVersion: EVALUATION_SCHEMA_VERSION,
        repository,
        evaluation: evaluationProvenance,
        report,
      });
    } catch (error) {
      failedRecords.push(...buildFailureRecords([repository], error));
    }
  }
  return failedRecords;
};

export const evaluateRepositoryBatch = async ({
  daytona,
  createSandbox,
  repositoryGroups,
  evaluationDeadlineMilliseconds,
  evaluatorSourceHash,
  onRecord,
  paired,
}: EvaluateRepositoryBatchInput): Promise<ReadonlyArray<CorpusEvaluationRecord>> => {
  const sandboxName = `${DAYTONA_RUN_NAME}-${randomUUID()}`;
  let sandbox: Sandbox | undefined;
  let shouldRecoverSandbox = true;
  try {
    try {
      sandbox = await createSandbox(sandboxName, evaluationDeadlineMilliseconds);
    } catch (error) {
      shouldRecoverSandbox = !(error instanceof EvaluationDeadlineExceededError);
      return repositoryGroups.flatMap((repositoryGroup) =>
        buildFailureRecords(buildRepositories(repositoryGroup), error),
      );
    }
    const activeSandbox = sandbox;

    let evaluationProvenance: EvaluationProvenance;
    let baselineEvaluationProvenance: EvaluationProvenance | undefined;
    try {
      const provenanceTimeoutSeconds = getEvaluationTimeoutSeconds({
        deadlineMilliseconds: evaluationDeadlineMilliseconds,
        maximumTimeoutSeconds: SANDBOX_REPORT_DOWNLOAD_TIMEOUT_SECONDS,
      });
      const provenancePaths = paired
        ? [
            BASE_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
            TREATMENT_REACT_DOCTOR_EVALUATION_PROVENANCE_PATH,
          ]
        : [REACT_DOCTOR_EVALUATION_PROVENANCE_PATH];
      const provenanceContents = await Promise.all(
        provenancePaths.map((provenancePath) =>
          activeSandbox.fs.downloadFile(provenancePath, provenanceTimeoutSeconds),
        ),
      );
      const treatmentProvenanceContents = provenanceContents.at(-1);
      if (!treatmentProvenanceContents) {
        throw new Error("React Doctor evaluation provenance is missing");
      }
      evaluationProvenance = {
        ...parseReactDoctorEvaluationProvenance(treatmentProvenanceContents.toString("utf8")),
        evaluatorSourceHash,
      };
      const baselineProvenanceContents = paired ? provenanceContents[0] : undefined;
      if (baselineProvenanceContents) {
        baselineEvaluationProvenance = {
          ...parseReactDoctorEvaluationProvenance(baselineProvenanceContents.toString("utf8")),
          evaluatorSourceHash,
        };
      }
    } catch (error) {
      return repositoryGroups.flatMap((repositoryGroup) =>
        buildFailureRecords(buildRepositories(repositoryGroup), error),
      );
    }

    const failedRecords: CorpusEvaluationRecord[] = [];
    for (const repositoryGroup of repositoryGroups) {
      failedRecords.push(
        ...(await evaluateRepositoryGroup({
          sandbox: activeSandbox,
          repositoryGroup,
          evaluationProvenance,
          evaluationDeadlineMilliseconds,
          onRecord,
          paired:
            paired && baselineEvaluationProvenance
              ? {
                  baselineEvaluationProvenance,
                  runScansInParallel: paired.runScansInParallel,
                  onPairedRecords: paired.onPairedRecords,
                }
              : undefined,
        })),
      );
    }
    return failedRecords;
  } finally {
    let sandboxToDelete = sandbox;
    if (!sandboxToDelete && shouldRecoverSandbox) {
      try {
        sandboxToDelete = await runBeforeDeadline({
          operation: () => daytona.get(sandboxName),
          deadlineMilliseconds: evaluationDeadlineMilliseconds,
          timeoutMessage: `Timed out recovering Daytona sandbox ${sandboxName}`,
        });
      } catch (error) {
        if (!(error instanceof DaytonaNotFoundError)) {
          process.stderr.write(
            `Failed to recover Daytona sandbox ${sandboxName}: ${toErrorMessage(error)}\n`,
          );
        }
      }
    }
    if (sandboxToDelete) {
      try {
        await runBeforeDeadline({
          operation: () => daytona.delete(sandboxToDelete, SANDBOX_DELETE_TIMEOUT_SECONDS),
          deadlineMilliseconds: evaluationDeadlineMilliseconds,
          timeoutMessage: `Timed out deleting Daytona sandbox ${sandboxToDelete.id}`,
        });
      } catch (error) {
        process.stderr.write(
          `Failed to delete Daytona sandbox ${sandboxToDelete.id}: ${toErrorMessage(error)}\n`,
        );
      }
    }
  }
};
