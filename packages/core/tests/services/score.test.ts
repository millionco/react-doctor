import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Score } from "../../src/services/score.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("returns null when configured with scoring disabled (layerOf(null))", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const score = yield* Score;
        return yield* score.compute({ diagnostics: [] });
      }).pipe(Effect.provide(Score.layerOf(null))),
    );
    expect(result).toBeNull();
  });
});

describe("Score.layerHttp", () => {
  it("runs score requests through the Effect HTTP client", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          score: 91,
          label: "Excellent",
        }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const score = yield* Score;
        return yield* score.compute({ diagnostics: [] });
      }).pipe(
        Effect.provide(Score.layerHttp),
        Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
      ),
    );

    expect(result).toEqual({ score: 91, label: "Excellent" });
  });
});
