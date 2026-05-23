import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Diagnostic, ScoreResult } from "../types/index.js";
import { calculateScore } from "../calculate-score.js";

interface ComputeInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly isCi?: boolean;
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
   * the caller picks based on `--offline`.
   *
   * `Effect.fn("Score.compute")` wraps the body so the effect carries
   * an OpenTelemetry-compatible span name out of the box (canonical
   * eval pattern from `react-doctor-evals/src/Runner.ts`). Zero runtime
   * cost when no tracing layer is provided; surfaces in
   * `Otlp.layerJson` traces when one is.
   */
  static readonly layerHttp = Layer.succeed(
    Score,
    Score.of({
      compute: Effect.fn("Score.compute")(function* (input: ComputeInput) {
        return yield* Effect.promise(() =>
          calculateScore([...input.diagnostics], { isCi: input.isCi }).catch(
            (): ScoreResult | null => null,
          ),
        );
      }),
    }),
  );

  static readonly layerOf = (result: ScoreResult | null): Layer.Layer<Score> =>
    Layer.succeed(
      Score,
      Score.of({
        compute: () => Effect.succeed(result),
      }),
    );
}
