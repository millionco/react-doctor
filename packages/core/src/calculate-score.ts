import { gzipSync } from "node:zlib";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FETCH_TIMEOUT_MS, SCORE_API_URL } from "./constants.js";
import type { Diagnostic, ProjectInfo, ScoreResult } from "./types/index.js";

// Score API response shape, including the optional per-rule `priority`/`tier`
// payload. `Schema.Struct` ignores unknown fields, so extra keys (e.g.
// `stored`) pass through harmlessly.
const RulePrioritySchema = Schema.Struct({
  priority: Schema.NullOr(Schema.Number),
  tier: Schema.Literals(["P0", "P1", "P2", "P3"]),
});

const ScoreApiResponseSchema = Schema.Struct({
  score: Schema.Number,
  label: Schema.String,
  rules: Schema.optional(Schema.Record(Schema.String, RulePrioritySchema)),
});

// Decode the score API response; any shape mismatch drops the whole result to
// null, so a malformed payload simply falls back to "no score" (and severity
// ordering at render time) rather than throwing.
const parseScoreResult = (value: unknown): ScoreResult | null =>
  Option.getOrNull(Schema.decodeUnknownOption(ScoreApiResponseSchema)(value));

const stripFilePaths = (diagnostics: Diagnostic[]): Omit<Diagnostic, "filePath">[] =>
  diagnostics.map(({ filePath: _filePath, ...rest }) => rest);

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

const describeFailure = (error: unknown): string => {
  if (isAbortError(error)) return `timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
  if (error instanceof Error && error.message) return error.message;
  return String(error);
};

export interface CalculateScoreOptions {
  /** Marks the run as CI-originated. */
  isCi?: boolean;
  metadata?: ScoreRequestMetadata;
}

export interface ScoreRequestMetadata {
  repo?: string;
  sha?: string;
  framework?: ProjectInfo["framework"];
  reactVersion?: string;
  sourceFileCount?: number;
  defaultBranch?: string;
  doctorVersion?: string;
  githubEventName?: string;
  githubActorAssociation?: string;
  githubViewerPermission?: string;
}

export const calculateScore = async (
  diagnostics: Diagnostic[],
  options: CalculateScoreOptions = {},
): Promise<ScoreResult | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const requestUrl = options.isCi ? `${SCORE_API_URL}?ci=1` : SCORE_API_URL;

  try {
    const requestBody = JSON.stringify({
      diagnostics: stripFilePaths(diagnostics),
      ...(options.metadata?.repo ? { repo: options.metadata.repo } : {}),
      ...(options.metadata?.sha ? { sha: options.metadata.sha } : {}),
      ...(options.metadata?.framework ? { framework: options.metadata.framework } : {}),
      ...(options.metadata?.reactVersion ? { reactVersion: options.metadata.reactVersion } : {}),
      ...(typeof options.metadata?.sourceFileCount === "number"
        ? { sourceFileCount: options.metadata.sourceFileCount }
        : {}),
      ...(options.metadata?.defaultBranch ? { defaultBranch: options.metadata.defaultBranch } : {}),
      ...(options.metadata?.doctorVersion ? { doctorVersion: options.metadata.doctorVersion } : {}),
      ...(options.metadata?.githubEventName
        ? { githubEventName: options.metadata.githubEventName }
        : {}),
      ...(options.metadata?.githubActorAssociation
        ? { githubActorAssociation: options.metadata.githubActorAssociation }
        : {}),
      ...(options.metadata?.githubViewerPermission
        ? { githubViewerPermission: options.metadata.githubViewerPermission }
        : {}),
    });
    const compressedBody = gzipSync(requestBody);

    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: compressedBody,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[react-doctor] Score API returned ${response.status} ${response.statusText}`);
      return null;
    }

    return parseScoreResult(await response.json());
  } catch (error) {
    console.warn(`[react-doctor] Score API unreachable (${describeFailure(error)})`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};
