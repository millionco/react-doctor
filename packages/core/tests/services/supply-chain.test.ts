import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { describe, expect, it, vi } from "vite-plus/test";

const checkSupplyChainSpy = vi.hoisted(() =>
  vi.fn(() => Effect.succeed([] as ReadonlyArray<unknown>)),
);

vi.mock("../../src/check-supply-chain.js", () => ({
  checkSupplyChain: checkSupplyChainSpy,
}));

import { SupplyChainOverlapTimeoutMs } from "../../src/refs.js";
import { SupplyChain } from "../../src/services/supply-chain.js";

describe("SupplyChain.layerNode", () => {
  it("threads the configured overlap budget into the check's inner wall-clock cap", async () => {
    const configuredTimeoutMs = 245_000;
    await Effect.runPromise(
      Effect.gen(function* () {
        const supplyChain = yield* SupplyChain;
        yield* Stream.runCollect(supplyChain.run({ rootDirectory: "/repo", userConfig: null }));
      }).pipe(
        Effect.provide(SupplyChain.layerNode),
        // The ref is what `REACT_DOCTOR_SUPPLY_CHAIN_TIMEOUT_MS` seeds — if
        // the layer stops threading it, the inner cap silently pins back to
        // the 90s constant and the env var can only ever LOWER the budget.
        Effect.provide(Layer.succeed(SupplyChainOverlapTimeoutMs, configuredTimeoutMs)),
      ),
    );

    expect(checkSupplyChainSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        rootDirectory: "/repo",
        totalTimeoutMs: configuredTimeoutMs,
      }),
    );
  });
});
