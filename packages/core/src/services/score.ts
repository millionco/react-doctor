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
  /**
   * Hosted score API. Network failures collapse to `null` rather than
   * propagating through the error channel — score isn't load-bearing
   * for the linter contract, and the renderer distinguishes "user
   * opted out" from "we tried and failed" via a separate `noScoreMessage`
   * the caller picks based on `--no-score`.
   *
   * `Effect.fn("Score.compute")` wraps the body so the effect carries
   * an OpenTelemetry-compatible span name out of the box (canonical
   * eval pattern from `react-doctor-evals/src/Runner.ts`). Zero runtime
   * cost when no tracing layer is provided; surfaces in
   * `Otlp.layerJson` traces when one is.
   */
  static readonly layerHttp = Layer.effect(
    Score,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      return Score.of({
        compute: Effect.fn("Score.compute")(function* (input: ComputeInput) {
          return yield* requestScore(httpClient, input.diagnostics, {
            isCi: input.isCi,
            metadata: input.metadata,
          });
        }),
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
