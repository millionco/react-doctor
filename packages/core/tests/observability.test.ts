import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vite-plus/test";
import { layerOtlp } from "../src/observability.js";

const withoutOtlpEnv = async <A>(body: () => Promise<A>): Promise<A> => {
  const previous = {
    endpoint: process.env["REACT_DOCTOR_OTLP_ENDPOINT"],
    auth: process.env["REACT_DOCTOR_OTLP_AUTH_HEADER"],
  };
  delete process.env["REACT_DOCTOR_OTLP_ENDPOINT"];
  delete process.env["REACT_DOCTOR_OTLP_AUTH_HEADER"];
  try {
    return await body();
  } finally {
    if (previous.endpoint !== undefined) {
      process.env["REACT_DOCTOR_OTLP_ENDPOINT"] = previous.endpoint;
    }
    if (previous.auth !== undefined) {
      process.env["REACT_DOCTOR_OTLP_AUTH_HEADER"] = previous.auth;
    }
  }
};

describe("layerOtlp", () => {
  it("is a no-op when REACT_DOCTOR_OTLP_ENDPOINT is missing", async () => {
    await withoutOtlpEnv(async () => {
      const program = Effect.succeed("ran");
      const result = await Effect.runPromise(program.pipe(Effect.provide(layerOtlp)));
      expect(result).toBe("ran");
    });
  });

  it("is a no-op when only the endpoint is set (auth header missing)", async () => {
    await withoutOtlpEnv(async () => {
      process.env["REACT_DOCTOR_OTLP_ENDPOINT"] = "https://example.invalid";
      const program = Effect.succeed("ran");
      const result = await Effect.runPromise(program.pipe(Effect.provide(layerOtlp)));
      expect(result).toBe("ran");
    });
  });

  it("composes with other layers without leaking requirements", async () => {
    await withoutOtlpEnv(async () => {
      const baseLayer = Layer.empty;
      const composed = Layer.merge(baseLayer, layerOtlp);
      const result = await Effect.runPromise(Effect.succeed(42).pipe(Effect.provide(composed)));
      expect(result).toBe(42);
    });
  });
});
