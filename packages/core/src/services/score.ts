import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type { Diagnostic, ScoreRequestMetadata, ScoreResult } from "../types/index.js";
import { requestScore } from "../request-score.js";

interface ComputeInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly isCi?: boolean;
  readonly metadata?: ScoreRequestMetadata;
}

export class Score extends Context.Service<
  Score,
  {
    readonly compute: (input: ComputeInput) => Effect.Effect<ScoreResult | null>;
  }
>()("react-doctor/Score") {
  static readonly layerHttp = Layer.effect(
    Score,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      return Score.of({
        compute: Effect.fn("Score.compute")((input: ComputeInput) =>
          requestScore(httpClient, input.diagnostics, {
            isCi: input.isCi,
            metadata: input.metadata,
          }),
        ),
      });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));

  static readonly layerOf = (result: ScoreResult | null): Layer.Layer<Score> =>
    Layer.succeed(
      Score,
      Score.of({
        compute: () => Effect.succeed(result),
      }),
    );
}
