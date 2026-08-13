import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { checkProjectAnalysis } from "../check-project-analysis.js";
import { DIAGNOSTIC_DELTA_IDENTITY } from "../compute-diagnostic-delta.js";
import {
  JSX_DUPLICATION_SOURCE_FILE_PATTERN,
  MAINTAINABILITY_CATEGORY,
  MAINTAINABILITY_DUPLICATE_JSX_RULE,
  MAINTAINABILITY_PLUGIN,
} from "../constants.js";
import {
  detectDuplicateJsxSubtreesCooperative,
  type DuplicateJsxSubtreeFamily,
  type DuplicateJsxSubtreeOccurrence,
  type JsxDuplicationIncompleteReason,
  type JsxDuplicationSourceReader,
} from "../react-cleanup/detect-duplicate-jsx-subtrees.js";
import type {
  ChangedFileLineRanges,
  Diagnostic,
  DiagnosticRelatedLocation,
} from "../types/index.js";
import { listSourceFilesWithSizeCooperative } from "../utils/list-source-files.js";
import { readTextFileUpToCharacterLimit } from "../utils/read-text-file-up-to-character-limit.js";
import { toNormalizedRelativePath } from "../utils/to-normalized-relative-path.js";
import { MaintainabilityAnalysisFailed, ReactDoctorError } from "../errors.js";
import { classifyFileContext } from "../classify-file-context.js";
import { compileGlobPatternsLenient } from "../utils/match-glob-pattern.js";
import { isFileIgnoredByPatterns } from "../is-ignored-file.js";
import { warnConfigIssue } from "../utils/warn-config-issue.js";

export interface MaintainabilityInput {
  readonly rootDirectory: string;
  readonly enabledProjectRuleIds?: ReadonlySet<string>;
  readonly focusPaths?: ReadonlyArray<string>;
  readonly changedLineRanges?: ReadonlyArray<ChangedFileLineRanges>;
  readonly excludedProjectDirectories?: ReadonlyArray<string>;
  readonly ignorePatterns?: ReadonlyArray<string>;
  readonly workerTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onIncomplete?: (reasons: ReadonlyArray<JsxDuplicationIncompleteReason>) => void;
}

const buildJsxSourceReader = async (
  input: MaintainabilityInput,
): Promise<JsxDuplicationSourceReader> => {
  const ignoredFilePatterns = compileGlobPatternsLenient(input.ignorePatterns ?? [], (error) =>
    warnConfigIssue(`ignore.files: ${error.message}`),
  );
  const sourceFiles = (
    await listSourceFilesWithSizeCooperative(input.rootDirectory, input.signal)
  ).filter(
    (sourceFile) =>
      JSX_DUPLICATION_SOURCE_FILE_PATTERN.test(sourceFile.path) &&
      classifyFileContext(sourceFile.path) === "production" &&
      !isFileIgnoredByPatterns(sourceFile.path, input.rootDirectory, ignoredFilePatterns),
  );
  const sourceSizeByPath = new Map(
    sourceFiles.map((sourceFile) => [
      toNormalizedRelativePath(sourceFile.path, input.rootDirectory),
      sourceFile.sizeBytes,
    ]),
  );
  return {
    paths: [...sourceSizeByPath.keys()],
    read: (filePath, maximumLengthChars) => {
      const absolutePath = path.resolve(input.rootDirectory, filePath);
      const sourceSizeBytes = sourceSizeByPath.get(filePath) ?? 0;
      return sourceSizeBytes <= maximumLengthChars
        ? fs.readFile(absolutePath, { encoding: "utf-8", signal: input.signal })
        : readTextFileUpToCharacterLimit({
            filePath: absolutePath,
            maximumLengthChars,
            sizeBytes: sourceSizeBytes,
            signal: input.signal,
          });
    },
  };
};

const allOccurrences = (family: DuplicateJsxSubtreeFamily): DuplicateJsxSubtreeOccurrence[] => [
  family.primaryOccurrence,
  ...family.relatedOccurrences,
];

const focusFamily = (
  family: DuplicateJsxSubtreeFamily,
  focusPaths: ReadonlySet<string> | null,
  changedLineRangesByPath: ReadonlyMap<string, ReadonlyArray<readonly [number, number]>> | null,
): DuplicateJsxSubtreeOccurrence[] | null => {
  const occurrences = allOccurrences(family);
  if (focusPaths === null && changedLineRangesByPath === null) return occurrences;
  const primaryOccurrence = occurrences.find((occurrence) => {
    if (focusPaths !== null && !focusPaths.has(occurrence.path)) return false;
    if (changedLineRangesByPath === null) return true;
    const changedRanges = changedLineRangesByPath.get(occurrence.path);
    return changedRanges?.some(
      ([startLine, endLine]) => occurrence.endLine >= startLine && occurrence.startLine <= endLine,
    );
  });
  if (primaryOccurrence === undefined) return null;
  return [
    primaryOccurrence,
    ...occurrences.filter((occurrence) => occurrence !== primaryOccurrence),
  ];
};

const buildRelatedLocation = (
  occurrence: DuplicateJsxSubtreeOccurrence,
  occurrenceNumber: number,
  occurrenceCount: number,
): DiagnosticRelatedLocation => ({
  filePath: occurrence.path,
  line: occurrence.startLine,
  column: occurrence.startColumn,
  endLine: occurrence.endLine,
  endColumn: occurrence.endColumn,
  message: `Matching JSX subtree (${occurrenceNumber} of ${occurrenceCount}) at ${occurrence.compositionPath.join(" > ")}.`,
});

const buildDuplicateJsxDiagnostic = (
  family: DuplicateJsxSubtreeFamily,
  occurrences: DuplicateJsxSubtreeOccurrence[],
): Diagnostic => {
  const [primaryOccurrence, ...relatedOccurrences] = occurrences;
  const fileLabel = family.distinctFileCount === 1 ? "file" : "files";
  const lineLabel = family.estimatedRemovableLineCount === 1 ? "line" : "lines";
  const diagnostic: Diagnostic = {
    filePath: primaryOccurrence.path,
    plugin: MAINTAINABILITY_PLUGIN,
    rule: MAINTAINABILITY_DUPLICATE_JSX_RULE,
    severity: "warning",
    title: "Duplicated JSX structure",
    message: `${family.occurrenceCount} copies of this ${family.nodeCount}-node JSX tree appear across ${family.distinctFileCount} ${fileLabel}, repeating about ${family.estimatedRemovableLineCount} ${lineLabel}. Composition path: ${primaryOccurrence.compositionPath.join(" > ")}.`,
    help: "Consider extracting a shared component if these trees represent the same UI concept. Keep them separate when the resemblance is incidental or the variants are likely to evolve independently.",
    line: primaryOccurrence.startLine,
    column: primaryOccurrence.startColumn,
    endLine: primaryOccurrence.endLine,
    endColumn: primaryOccurrence.endColumn,
    category: MAINTAINABILITY_CATEGORY,
    relatedLocations: relatedOccurrences.map((occurrence, relatedIndex) =>
      buildRelatedLocation(occurrence, relatedIndex + 2, family.occurrenceCount),
    ),
  };
  Object.defineProperty(diagnostic, DIAGNOSTIC_DELTA_IDENTITY, {
    enumerable: true,
    value: `${family.fingerprint}\0occurrences:${family.occurrenceCount}`,
  });
  return diagnostic;
};

const formatIncompleteReason = (reason: JsxDuplicationIncompleteReason): string => {
  if (reason.kind === "aborted") return "analysis was cancelled";
  const pathSuffix = reason.path === undefined ? "" : ` while scanning ${reason.path}`;
  return `${reason.kind} (${reason.observed} observed, limit ${reason.limit})${pathSuffix}`;
};

const runDuplicateJsxAnalysis = async (input: MaintainabilityInput): Promise<Diagnostic[]> => {
  const sourceReader = await buildJsxSourceReader(input);
  const focusPaths =
    input.focusPaths === undefined
      ? null
      : new Set(
          input.focusPaths.map((filePath) =>
            toNormalizedRelativePath(filePath, input.rootDirectory),
          ),
        );
  const changedLineRangesByPath =
    input.changedLineRanges === undefined
      ? null
      : new Map(
          input.changedLineRanges.map((entry) => [
            toNormalizedRelativePath(entry.file, input.rootDirectory),
            entry.ranges,
          ]),
        );
  const result = await detectDuplicateJsxSubtreesCooperative(sourceReader, {
    signal: input.signal,
  });
  if (result.incomplete) input.onIncomplete?.(result.incompleteReasons);

  const diagnostics: Diagnostic[] = [];
  for (const family of result.families) {
    const focusedOccurrences = focusFamily(family, focusPaths, changedLineRangesByPath);
    if (focusedOccurrences === null) continue;
    diagnostics.push(buildDuplicateJsxDiagnostic(family, focusedOccurrences));
  }
  return diagnostics;
};

const runMaintainability = async (input: MaintainabilityInput): Promise<Diagnostic[]> => {
  const enabledProjectRuleIds =
    input.enabledProjectRuleIds ?? new Set([MAINTAINABILITY_DUPLICATE_JSX_RULE]);
  const enabledGraphRuleIds = new Set(
    [...enabledProjectRuleIds].filter((ruleId) => ruleId !== MAINTAINABILITY_DUPLICATE_JSX_RULE),
  );
  const [duplicateJsxDiagnostics, projectGraphDiagnostics] = await Promise.all([
    enabledProjectRuleIds.has(MAINTAINABILITY_DUPLICATE_JSX_RULE)
      ? runDuplicateJsxAnalysis(input)
      : Promise.resolve([]),
    checkProjectAnalysis({
      rootDirectory: input.rootDirectory,
      enabledRuleIds: enabledGraphRuleIds,
      abortSignal: input.signal,
      excludedProjectDirectories: input.excludedProjectDirectories,
      ignorePatterns: input.ignorePatterns,
      workerTimeoutMs: input.workerTimeoutMs,
    }),
  ]);
  return [...duplicateJsxDiagnostics, ...projectGraphDiagnostics];
};

export const describeMaintainabilityIncompleteness = (
  reasons: ReadonlyArray<JsxDuplicationIncompleteReason>,
): string =>
  `Maintainability analysis was incomplete: ${reasons.map(formatIncompleteReason).join("; ")}.`;

export class Maintainability extends Context.Service<
  Maintainability,
  {
    readonly run: (input: MaintainabilityInput) => Stream.Stream<Diagnostic, ReactDoctorError>;
  }
>()("react-doctor/Maintainability") {
  static readonly layerNode = Layer.succeed(
    Maintainability,
    Maintainability.of({
      run: (input) =>
        Stream.unwrap(
          Effect.fn("Maintainability.run")(function* () {
            return yield* Effect.tryPromise({
              try: (effectSignal) =>
                runMaintainability({
                  ...input,
                  signal:
                    input.signal === undefined
                      ? effectSignal
                      : AbortSignal.any([input.signal, effectSignal]),
                }),
              catch: (cause) =>
                new ReactDoctorError({ reason: new MaintainabilityAnalysisFailed({ cause }) }),
            }).pipe(Effect.map((diagnostics) => Stream.fromIterable(diagnostics)));
          })(),
        ),
    }),
  );

  static readonly layerOf = (
    diagnostics: ReadonlyArray<Diagnostic>,
  ): Layer.Layer<Maintainability> =>
    Layer.succeed(
      Maintainability,
      Maintainability.of({
        run: () => Stream.fromIterable(diagnostics),
      }),
    );
}
