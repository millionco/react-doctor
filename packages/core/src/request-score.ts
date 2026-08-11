import { STATUS_CODES } from "node:http";
import { gzipSync } from "node:zlib";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import {
  FETCH_TIMEOUT_MS,
  HTTP_SUCCESS_STATUS_CODE_MAX_EXCLUSIVE,
  HTTP_SUCCESS_STATUS_CODE_MIN,
  MILLISECONDS_PER_SECOND,
  SCORE_API_URL,
} from "./constants.js";
import type {
  CalculateScoreOptions,
  Diagnostic,
  ScoreRequestMetadata,
  ScoreResult,
} from "./types/index.js";
import { messageFromUnknown } from "./utils/message-from-unknown.js";
import { redactSensitiveText } from "./utils/redact-sensitive-text.js";
import { scrubSensitivePaths } from "./utils/scrub-sensitive-paths.js";

const RulePrioritySchema = Schema.Struct({
  priority: Schema.NullOr(Schema.Number),
  tier: Schema.Literals(["P0", "P1", "P2", "P3"]),
});

const ScoreApiResponseSchema = Schema.Struct({
  score: Schema.Number,
  label: Schema.String,
  rules: Schema.optional(Schema.Record(Schema.String, RulePrioritySchema)),
});

const EMPTY_SCORE_REQUEST_METADATA: ScoreRequestMetadata = {};

const parseScoreResult = (value: unknown): ScoreResult | null =>
  Option.getOrNull(Schema.decodeUnknownOption(ScoreApiResponseSchema)(value));

const sanitizeScoreDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
): ReadonlyArray<Omit<Diagnostic, "fileContext" | "fixGroupId">> =>
  diagnostics.map(({ filePath, fileContext: _fileContext, fixGroupId: _fixGroupId, ...rest }) => ({
    ...rest,
    filePath: redactSensitiveText(scrubSensitivePaths(filePath)),
  }));

const isPresentMetadataValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  return value !== "";
};

const buildScoreRequestMetadata = (
  metadata: ScoreRequestMetadata | undefined,
): Record<string, unknown> => {
  const resolvedMetadata = metadata || EMPTY_SCORE_REQUEST_METADATA;
  return Object.fromEntries(
    Object.entries({
      repo: resolvedMetadata.repo,
      sha: resolvedMetadata.sha,
      framework: resolvedMetadata.framework,
      reactVersion: resolvedMetadata.reactVersion,
      sourceFileCount:
        typeof resolvedMetadata.sourceFileCount === "number"
          ? resolvedMetadata.sourceFileCount
          : undefined,
      defaultBranch: resolvedMetadata.defaultBranch,
      doctorVersion: resolvedMetadata.doctorVersion,
      runId: resolvedMetadata.runId,
      githubEventName: resolvedMetadata.githubEventName,
      githubActorAssociation: resolvedMetadata.githubActorAssociation,
      githubViewerPermission: resolvedMetadata.githubViewerPermission,
    }).filter(([, value]) => isPresentMetadataValue(value)),
  );
};

const buildScoreRequestBody = (
  diagnostics: ReadonlyArray<Diagnostic>,
  options: CalculateScoreOptions,
): Uint8Array => {
  return gzipSync(
    JSON.stringify({
      diagnostics: sanitizeScoreDiagnostics(diagnostics),
      ...buildScoreRequestMetadata(options.metadata),
    }),
  );
};

const warnScoreFailure = (detail: string): Effect.Effect<null> =>
  Console.warn(`[react-doctor] Score API unreachable (${detail})`).pipe(Effect.as(null));

const describeScoreFailure = (error: unknown): string => {
  if (HttpClientError.isHttpClientError(error) && error.reason.cause !== undefined) {
    return messageFromUnknown(error.reason.cause);
  }
  return messageFromUnknown(error);
};

const describeHttpStatus = (status: number): string => {
  const statusText = STATUS_CODES[status];
  if (statusText === undefined) return String(status);
  return `${status} ${statusText}`;
};

export const requestScore = (
  httpClient: HttpClient.HttpClient,
  diagnostics: ReadonlyArray<Diagnostic>,
  options: CalculateScoreOptions = {},
): Effect.Effect<ScoreResult | null> => {
  const requestUrl = options.isCi ? `${SCORE_API_URL}?ci=1` : SCORE_API_URL;
  const request = Effect.gen(function* () {
    const compressedBody = yield* Effect.try({
      try: () => buildScoreRequestBody(diagnostics, options),
      catch: (cause) => cause,
    });
    const response = yield* httpClient.execute(
      HttpClientRequest.post(requestUrl).pipe(
        HttpClientRequest.bodyUint8Array(compressedBody, "application/json"),
        HttpClientRequest.setHeader("Content-Encoding", "gzip"),
      ),
    );
    if (
      response.status < HTTP_SUCCESS_STATUS_CODE_MIN ||
      response.status >= HTTP_SUCCESS_STATUS_CODE_MAX_EXCLUSIVE
    ) {
      yield* Console.warn(
        `[react-doctor] Score API returned ${describeHttpStatus(response.status)}`,
      );
      return null;
    }
    return parseScoreResult(yield* response.json);
  }).pipe(Effect.timeoutOption(FETCH_TIMEOUT_MS));

  return Effect.matchEffect(request, {
    onFailure: (error) => warnScoreFailure(describeScoreFailure(error)),
    onSuccess: (result) =>
      Option.match(result, {
        onNone: () =>
          warnScoreFailure(`timed out after ${FETCH_TIMEOUT_MS / MILLISECONDS_PER_SECOND}s`),
        onSome: Effect.succeed,
      }),
  });
};
