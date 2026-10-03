import { createHash } from "node:crypto";
import { posix } from "node:path";

import { z } from "zod";

import {
  CLASSIFICATION_MAX_CODE_CHARACTERS,
  CLASSIFICATION_CONCURRENCY,
  CLASSIFICATION_SCHEMA_VERSION,
  CLASSIFICATION_TIMEOUT_MS,
  PINNED_REPOSITORY_REF_PATTERN,
} from "./constants.js";
import type { ClassificationCandidate, RuleContract } from "./classification-schema.js";
import { classificationCandidateSchema } from "./classification-schema.js";
import type { CorpusRepository } from "./corpus.js";
import { parseCorpusRepository } from "./utils/parse-corpus-repository.js";
import { parseReactDoctorEvaluationProvenance } from "./utils/parse-react-doctor-evaluation-provenance.js";
import { parseReactDoctorReport } from "./utils/parse-react-doctor-report.js";
import { toErrorMessage } from "./utils/to-error-message.js";
import { createConcurrencyLimit } from "./utils/create-concurrency-limit.js";

const classificationReportSchema = z.object({
  schemaVersion: z.literal(3),
  directory: z.string(),
  mode: z.literal("full"),
  projects: z.array(
    z.object({
      packageRoot: z.string(),
      framework: z.string(),
      project: z.record(z.string(), z.json()),
      analyzedFiles: z.array(z.string()),
      diagnostics: z.array(
        z.object({
          normalizedFilePath: z.string(),
          plugin: z.string(),
          rule: z.string(),
          line: z.number().int().nonnegative(),
          column: z.number().int().nonnegative(),
        }),
      ),
    }),
  ),
});

const evaluationRecordSchema = z.object({
  repository: z.unknown(),
  evaluation: z.unknown(),
  report: z.unknown(),
  error: z.never().optional(),
});

export interface ClassificationSourceLoader {
  (repository: CorpusRepository, filePath: string): Promise<string>;
}

export interface PrepareClassificationOptions {
  rules: ReadonlyArray<RuleContract>;
  silentFilesPerProject: number;
  loadSource: ClassificationSourceLoader;
  concurrency?: number;
  limit?: number;
}

const sourcePath = (root: string, filePath: string): string => {
  const relativePath = posix.normalize(posix.join(root, filePath));
  if (
    posix.isAbsolute(filePath) ||
    posix.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0")
  ) {
    throw new Error(`Source path escapes the pinned repository: ${filePath}`);
  }
  return relativePath;
};

export const loadPinnedClassificationSource: ClassificationSourceLoader = async (
  repository,
  filePath,
) => {
  const path = [repository.org, repository.name, repository.ref, ...filePath.split("/")]
    .map(encodeURIComponent)
    .join("/");
  const response = await fetch(`https://raw.githubusercontent.com/${path}`, {
    signal: AbortSignal.timeout(CLASSIFICATION_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Pinned source fetch failed (${response.status})`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Pinned source response has no body");
  const decoder = new TextDecoder();
  let source = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      source += decoder.decode(chunk.value, { stream: true });
      if (source.length > CLASSIFICATION_MAX_CODE_CHARACTERS) {
        throw new Error("Source exceeds the classification context limit");
      }
    }
    return source + decoder.decode();
  } finally {
    await reader.cancel();
  }
};

export const prepareClassificationCandidates = async function* (
  record: unknown,
  options: PrepareClassificationOptions,
): AsyncGenerator<ClassificationCandidate> {
  if (!Number.isInteger(options.silentFilesPerProject) || options.silentFilesPerProject < 0) {
    throw new Error("silentFilesPerProject must be a nonnegative integer");
  }
  const parsed = evaluationRecordSchema.parse(record);
  const repository = parseCorpusRepository(parsed.repository);
  if (!repository || !PINNED_REPOSITORY_REF_PATTERN.test(repository.ref)) {
    throw new Error("Classification requires a pinned corpus repository");
  }
  const evaluation = parseReactDoctorEvaluationProvenance(JSON.stringify(parsed.evaluation));
  const report = classificationReportSchema.parse(
    parseReactDoctorReport(JSON.stringify(parsed.report)),
  );
  const enabledRuleKeys = new Set(evaluation.ruleKeys);
  for (const rule of options.rules) {
    if (enabledRuleKeys.size > 0 && !enabledRuleKeys.has(rule.key)) {
      throw new Error(`Rule ${rule.key} was not enabled in this evaluation`);
    }
  }
  const sources = new Map<string, Promise<{ code: string; contextIssue?: string }>>();
  const limitConcurrency = createConcurrencyLimit(
    options.concurrency ?? CLASSIFICATION_CONCURRENCY,
  );
  const seen = new Set<string>();
  let prepared = 0;
  for (const project of report.projects) {
    const projectRoot = posix.relative(
      report.directory,
      posix.resolve(report.directory, project.packageRoot),
    );
    const toSourcePath = (filePath: string) =>
      sourcePath(repository.rootDir, sourcePath(projectRoot, filePath));
    const analyzedFiles = new Set(project.analyzedFiles.map(toSourcePath));
    for (const rule of options.rules) {
      const diagnostics = project.diagnostics.filter(
        (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}` === rule.key,
      );
      const detectedFiles = new Set(
        diagnostics.map((diagnostic) => toSourcePath(diagnostic.normalizedFilePath)),
      );
      const samplingHash = (filePath: string) =>
        createHash("sha256").update(`${repository.ref}:${rule.key}:${filePath}`).digest("hex");
      const silentFiles =
        options.silentFilesPerProject === 0 || rule.sampleSilentFiles === false
          ? []
          : [...analyzedFiles]
              .filter((filePath) => !detectedFiles.has(filePath))
              .sort((left, right) => samplingHash(left).localeCompare(samplingHash(right)))
              .slice(0, options.silentFilesPerProject);
      const targets = [
        ...diagnostics.map((diagnostic) => ({
          filePath: toSourcePath(diagnostic.normalizedFilePath),
          line: diagnostic.line || null,
          column: diagnostic.column || null,
          detected: true,
        })),
        ...silentFiles.map((filePath) => ({ filePath, line: null, column: null, detected: false })),
      ].slice(0, options.limit === undefined ? undefined : options.limit - prepared);
      for (const target of targets) {
        if (!analyzedFiles.has(target.filePath)) {
          throw new Error(`Diagnostic is outside analyzed coverage: ${target.filePath}`);
        }
        if (sources.has(target.filePath)) continue;
        sources.set(
          target.filePath,
          limitConcurrency(() => options.loadSource(repository, target.filePath)).then(
            (code) =>
              code.length > CLASSIFICATION_MAX_CODE_CHARACTERS
                ? { code: "", contextIssue: "Source exceeds the classification context limit" }
                : { code },
            (error: unknown) => ({ code: "", contextIssue: toErrorMessage(error) }),
          ),
        );
      }
      for (const target of targets) {
        const identity = JSON.stringify([rule.key, target, project.framework]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        const source = sources.get(target.filePath);
        if (!source) throw new Error("Missing prepared source");
        const { code, contextIssue } = await source;
        const lineIsValid =
          !target.detected || (target.line !== null && target.line <= code.split("\n").length);
        yield classificationCandidateSchema.parse({
          schemaVersion: CLASSIFICATION_SCHEMA_VERSION,
          repository,
          detectorCommit: evaluation.reactDoctorCommit,
          ruleSetHash: evaluation.ruleSetHash,
          rule,
          ...target,
          framework: project.framework,
          project: {
            ...project.project,
            rootDirectory: sourcePath(repository.rootDir, projectRoot),
          },
          code,
          contextComplete: !contextIssue && code.trim().length > 0 && lineIsValid,
          contextIssue:
            contextIssue ?? (!lineIsValid ? "Diagnostic has no valid source line" : undefined),
        });
        prepared += 1;
        if (options.limit !== undefined && prepared >= options.limit) return;
      }
    }
  }
};
