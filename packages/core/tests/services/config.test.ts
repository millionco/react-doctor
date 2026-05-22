import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { Config } from "../../src/services/config.js";

describe("Config.layerOf", () => {
  it("returns the supplied resolved config regardless of directory", async () => {
    const resolved = {
      config: { lint: false } as never,
      resolvedDirectory: "/repo/apps/web",
    };
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* Config;
        return yield* config.resolve("/anywhere");
      }).pipe(Effect.provide(Config.layerOf(resolved))),
    );
    expect(result).toBe(resolved);
  });
});

describe("Config.layerNode", () => {
  it("resolves a directory with no config to { config: null, resolvedDirectory: directory }", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* Config;
        return yield* config.resolve("/this/path/should/not/exist/cfg-test-12345");
      }).pipe(Effect.provide(Config.layerNode)),
    );
    expect(result.config).toBeNull();
    expect(result.resolvedDirectory).toBe("/this/path/should/not/exist/cfg-test-12345");
  });

  it("caches repeated calls for the same directory", async () => {
    const program = Effect.gen(function* () {
      const config = yield* Config;
      const first = yield* config.resolve("/cache-test");
      const second = yield* config.resolve("/cache-test");
      return { first, second };
    });
    const { first, second } = await Effect.runPromise(
      program.pipe(Effect.provide(Config.layerNode)),
    );
    expect(first).toBe(second);
  });
});
