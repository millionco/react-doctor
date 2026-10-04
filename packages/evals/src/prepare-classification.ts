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
          id: z.string().optional(),
          normalizedFilePath: z.string(),
          plugin: z.string(),
          rule: z.string(),
          line: z.number().int().nonnegative(),
          column: z.number().int().nonnegative(),
          message: z.string().optional(),
          help: z.string().optional(),
          tags: z.array(z.string()).optional(),
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
  metadataOnly?: boolean;
  groupOccurrences?: boolean;
  population?: "default" | "exhaustive" | "explicit-contract";
}

export const sourcePath = (root: string, filePath: string): string => {
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

export class PinnedSourceMissingError extends Error {}

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
  if (response.status === 404) throw new PinnedSourceMissingError("Pinned source is absent");
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
  const { evaluatorSourceHash } = z
    .object({
      evaluatorSourceHash: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
    })
    .parse(parsed.evaluation);
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
  const seenGroups = new Set<string>();
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
      if (options.population === "default" && rule.defaultEnabled !== true) continue;
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
      const occurrences = new Map<string, NonNullable<ClassificationCandidate["occurrences"]>>();
      for (const diagnostic of diagnostics) {
        const filePath = toSourcePath(diagnostic.normalizedFilePath);
        const members = occurrences.get(filePath) ?? [];
        const id = createHash("sha256")
          .update(JSON.stringify([repository, projectRoot, rule.key, diagnostic]))
          .digest("hex");
        members.push({ ...diagnostic, id, diagnosticId: diagnostic.id });
        occurrences.set(filePath, members);
      }
      for (const members of occurrences.values()) {
        members.sort(
          (left, right) =>
            left.line - right.line || left.column - right.column || left.id.localeCompare(right.id),
        );
      }
      const diagnosticTargets = options.groupOccurrences
        ? [...occurrences].map(([filePath, members]) => ({
            filePath,
            line: members[0].line || null,
            column: members[0].column || null,
            detected: true,
          }))
        : diagnostics.map((diagnostic) => ({
            filePath: toSourcePath(diagnostic.normalizedFilePath),
            line: diagnostic.line || null,
            column: diagnostic.column || null,
            detected: true,
          }));
      const targets = [
        ...diagnosticTargets,
        ...silentFiles.map((filePath) => ({ filePath, line: null, column: null, detected: false })),
      ].slice(0, options.limit === undefined ? undefined : options.limit - prepared);
      for (const target of targets) {
        if (!analyzedFiles.has(target.filePath)) {
          throw new Error(
            `Diagnostic is outside analyzed coverage: ${target.filePath} (${rule.key})`,
          );
        }
        if (options.metadataOnly) continue;
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
        if (options.groupOccurrences) {
          const group = JSON.stringify([rule.key, target.filePath]);
          if (seenGroups.has(group))
            throw new Error("Overlapping project coverage for a file/rule group");
          seenGroups.add(group);
        }
        const identity = JSON.stringify([rule.key, target, project.framework]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        const source = sources.get(target.filePath);
        if (!source && !options.metadataOnly) throw new Error("Missing prepared source");
        const { code, contextIssue } = (await source) ?? {
          code: "",
          contextIssue: "Source not loaded",
        };
        const lineIsValid =
          !target.detected || (target.line !== null && target.line <= code.split("\n").length);
        yield classificationCandidateSchema.parse({
          schemaVersion: CLASSIFICATION_SCHEMA_VERSION,
          repository,
          detectorCommit: evaluation.reactDoctorCommit,
          ruleSetHash: evaluation.ruleSetHash,
          evaluatorSourceHash,
          rule,
          policy: {
            population: options.population ?? "explicit-contract",
            scan: enabledRuleKeys.size === 0 ? "exhaustive" : "explicit-rule-list",
            configContract: evaluation.configContract,
            repositoryPolicy: "unobserved",
            adoptExistingLintConfig: false,
            respectInlineDisables: false,
            severity: "error",
          },
          occurrences: options.groupOccurrences
            ? (occurrences.get(target.filePath) ?? [])
            : undefined,
          occurrenceCount: options.groupOccurrences
            ? (occurrences.get(target.filePath)?.length ?? 0)
            : undefined,
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
