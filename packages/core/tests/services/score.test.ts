import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { Score } from "../../src/services/score.js";

describe("Score.layerOf", () => {
  it("returns the supplied ScoreResult", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const score = yield* Score;
        return yield* score.compute({ diagnostics: [] });
      }).pipe(Effect.provide(Score.layerOf({ score: 85, label: "Good" }))),
    );
    expect(result).toEqual({ score: 85, label: "Good" });
  });

  it("returns null when configured offline-style (layerOf(null))", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const score = yield* Score;
        return yield* score.compute({ diagnostics: [] });
      }).pipe(Effect.provide(Score.layerOf(null))),
    );
    expect(result).toBeNull();
  });
});
