import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Diagnostic, ScoreResult } from "../types/index.js";
import { calculateScore, type ScoreRequestMetadata } from "../calculate-score.js";

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
  static readonly layerHttp = Layer.succeed(
    Score,
    Score.of({
      compute: Effect.fn("Score.compute")(function* (input: ComputeInput) {
        return yield* Effect.promise(() =>
          calculateScore(input.diagnostics, {
            isCi: input.isCi,
            metadata: input.metadata,
          }),
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
