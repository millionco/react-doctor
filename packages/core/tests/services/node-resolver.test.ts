import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { NodeResolver } from "@react-doctor/core";

describe("NodeResolver.layerOf", () => {
  it("returns the snapshot resolution from resolve()", async () => {
    const layer = NodeResolver.layerOf({
      resolution: {
        binaryPath: "/usr/local/bin/node",
        isCurrentNode: false,
        version: "v22.12.0",
      },
    });

    const resolution = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* NodeResolver;
        return yield* resolver.resolve();
      }).pipe(Effect.provide(layer)),
    );

    expect(resolution).toEqual({
      binaryPath: "/usr/local/bin/node",
      isCurrentNode: false,
      version: "v22.12.0",
    });
  });

  it("reports null when no resolution is configured", async () => {
    const layer = NodeResolver.layerOf({});

    const resolution = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* NodeResolver;
        return yield* resolver.resolve();
      }).pipe(Effect.provide(layer)),
    );

    expect(resolution).toBeNull();
  });

  it("flips resolve() to the afterInstall snapshot once installViaNvm runs", async () => {
    const layer = NodeResolver.layerOf({
      resolution: null,
      afterInstall: {
        binaryPath: "/Users/me/.nvm/versions/node/v22.20.0/bin/node",
        isCurrentNode: false,
        version: "v22.20.0",
      },
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* NodeResolver;
        const before = yield* resolver.resolve();
        const didInstall = yield* resolver.installViaNvm();
        const after = yield* resolver.resolve();
        return { before, didInstall, after };
      }).pipe(Effect.provide(layer)),
    );

    expect(result.before).toBeNull();
    expect(result.didInstall).toBe(true);
    expect(result.after?.version).toBe("v22.20.0");
  });

  it("returns false from installViaNvm when no after-install resolution is configured", async () => {
    const layer = NodeResolver.layerOf({ isNvmInstalled: true });

    const didInstall = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* NodeResolver;
        return yield* resolver.installViaNvm();
      }).pipe(Effect.provide(layer)),
    );

    expect(didInstall).toBe(false);
  });

  it("reports the snapshot's isNvmInstalled flag", async () => {
    const layer = NodeResolver.layerOf({ isNvmInstalled: true });
    const isInstalled = await Effect.runPromise(
      Effect.gen(function* () {
        const resolver = yield* NodeResolver;
        return yield* resolver.isNvmInstalled();
      }).pipe(Effect.provide(layer)),
    );
    expect(isInstalled).toBe(true);
  });
});
