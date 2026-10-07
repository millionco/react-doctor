import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type { CalculateScoreOptions, Diagnostic, ScoreResult } from "./types/index.js";
import { requestScore } from "./request-score.js";

export type { CalculateScoreOptions, ScoreRequestMetadata } from "./types/score.js";

export const calculateScore = (
  diagnostics: Diagnostic[],
  options: CalculateScoreOptions = {},
): Promise<ScoreResult | null> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      return yield* requestScore(httpClient, diagnostics, options);
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
    ),
  );
